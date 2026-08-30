import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discoverDataLakeObjects,
  downloadDataLakeObject,
  parseSessionHeaders,
  safeDataLakeSourceLabel,
} from './data-lake';

function xmlResponse(body: string) {
  return new Response(body, {
    headers: { 'content-type': 'application/xml' },
  });
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

void test('discovers supported S3 objects across continuation pages', async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = requestUrl(input);
    requests.push(url);
    return requests.length === 1
      ? xmlResponse(`
          <ListBucketResult>
            <IsTruncated>true</IsTruncated>
            <NextContinuationToken>next page</NextContinuationToken>
            <Contents><Key>lake%2Fsales.csv</Key><Size>42</Size></Contents>
            <Contents><Key>lake%2Fignore.png</Key><Size>2</Size></Contents>
          </ListBucketResult>`)
      : xmlResponse(`
          <ListBucketResult>
            <IsTruncated>false</IsTruncated>
            <Contents><Key>lake%2Ffacts.parquet</Key><Size>84</Size></Contents>
          </ListBucketResult>`);
  };

  const result = await discoverDataLakeObjects(
    {
      provider: 's3',
      endpoint: 'https://bucket.example.test/data/',
      prefix: 'lake/',
      maxObjects: 10,
    },
    fetcher,
  );

  assert.deepEqual(
    result.objects.map((object) => object.key),
    ['lake/sales.csv', 'lake/facts.parquet'],
  );
  assert.equal(
    result.objects[0]?.url,
    'https://bucket.example.test/data/lake/sales.csv',
  );
  assert.equal(
    requests[1]?.searchParams.get('continuation-token'),
    'next page',
  );
  assert.equal(result.scanned, 3);
  assert.equal(result.truncated, false);
});

void test('keeps Azure SAS parameters on listed blob downloads', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = requestUrl(input);
    assert.equal(url.searchParams.get('sig'), 'session-signature');
    assert.equal(url.searchParams.get('comp'), 'list');
    return xmlResponse(`
      <EnumerationResults>
        <Blobs>
          <Blob>
            <Name>curated/orders.xlsx</Name>
            <Properties><Content-Length>120</Content-Length></Properties>
          </Blob>
        </Blobs>
        <NextMarker />
      </EnumerationResults>`);
  };
  const result = await discoverDataLakeObjects(
    {
      provider: 'azure',
      endpoint:
        'https://account.blob.core.windows.net/container?sv=2026-01-01&sig=session-signature',
    },
    fetcher,
  );

  const objectUrl = new URL(result.objects[0]?.url ?? '');
  assert.equal(objectUrl.pathname, '/container/curated/orders.xlsx');
  assert.equal(objectUrl.searchParams.get('sig'), 'session-signature');
  assert.equal(objectUrl.searchParams.has('comp'), false);
});

void test('discovers Google Cloud Storage objects with bearer headers', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    assert.equal(url.pathname, '/storage/v1/b/demo-bucket/o');
    assert.equal(url.searchParams.get('prefix'), 'warehouse/curated');
    assert.deepEqual(init?.headers, { Authorization: 'Bearer session' });
    return Response.json({
      items: [
        {
          name: 'warehouse/curated/events.json',
          size: '98',
        },
      ],
    });
  };
  const result = await discoverDataLakeObjects(
    {
      provider: 'gcs',
      endpoint: 'gs://demo-bucket/warehouse',
      prefix: 'curated',
      headers: { Authorization: 'Bearer session' },
    },
    fetcher,
  );

  assert.equal(result.objects[0]?.size, 98);
  assert.match(result.objects[0]?.url ?? '', /alt=media/u);
});

void test('loads a manifest and downloads binary object bodies', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = requestUrl(input).href;
    if (url.endsWith('/manifest.json')) {
      return Response.json({
        objects: [
          {
            url: './curated/facts.parquet?temporary=secret',
            headers: { 'X-Object-Token': 'session' },
          },
        ],
      });
    }
    assert.deepEqual(init?.headers, {
      Authorization: 'Bearer session',
      'X-Object-Token': 'session',
    });
    return new Response(new Uint8Array([80, 65, 82, 49]), {
      headers: { 'content-type': 'application/vnd.apache.parquet' },
    });
  };
  const discovery = await discoverDataLakeObjects(
    {
      provider: 'manifest',
      endpoint: 'https://lake.example.test/manifest.json',
    },
    fetcher,
  );
  const file = await downloadDataLakeObject(
    discovery.objects[0],
    { Authorization: 'Bearer session' },
    fetcher,
  );

  assert.equal(discovery.objects[0]?.key, 'curated/facts.parquet');
  assert.equal(file.name, 'facts.parquet');
  assert.deepEqual(
    Array.from(new Uint8Array(await file.arrayBuffer())),
    [80, 65, 82, 49],
  );
  assert.equal(
    safeDataLakeSourceLabel(discovery.objects[0].url),
    'https://lake.example.test/curated/facts.parquet',
  );
});

void test('accepts only string-valued session headers', () => {
  assert.deepEqual(parseSessionHeaders(''), {});
  assert.deepEqual(parseSessionHeaders('{"Authorization":"Bearer token"}'), {
    Authorization: 'Bearer token',
  });
  assert.throws(
    () => parseSessionHeaders('{"Retry":3}'),
    /JSON object of strings/u,
  );
});
