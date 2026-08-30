import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeUiLocale,
  translateBuiltinLabel,
  translateUiText,
} from './i18n';

void test('normalizes browser and persisted locale identifiers', () => {
  assert.equal(normalizeUiLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeUiLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeUiLocale('en-US'), 'en');
  assert.equal(normalizeUiLocale(undefined), 'en');
});

void test('translates exact interface messages while preserving whitespace', () => {
  assert.equal(translateUiText('zh-CN', 'Dashboard'), '报表');
  assert.equal(
    translateUiText('zh-CN', '\n  Data preparation  \n'),
    '\n  数据准备  \n',
  );
  assert.equal(translateUiText('en', 'Dashboard'), 'Dashboard');
});

void test('translates dynamic counts and progress notices', () => {
  assert.equal(translateUiText('zh-CN', '1,250 rows'), '1,250 行');
  assert.equal(
    translateUiText('zh-CN', 'Imported 3 table(s), 9,001 rows.'),
    '已导入 3 个表、9,001 行数据。',
  );
  assert.equal(
    translateUiText('zh-CN', 'Rendering 4 report pages…'),
    '正在渲染 4 个报表页面…',
  );
});

void test('translates connector controls and import status', () => {
  assert.equal(translateUiText('zh-CN', 'Data connectors'), '数据连接器');
  assert.equal(translateUiText('zh-CN', 'Data lake'), '数据湖');
  assert.equal(
    translateUiText(
      'zh-CN',
      'Discovered 12 supported object(s) from 18 scanned · result limit reached.',
    ),
    '已从 18 个扫描对象中发现 12 个支持的对象 · 已达到结果上限。',
  );
  assert.equal(
    translateUiText('zh-CN', 'Imported ODBC table with 1,250 rows in 42.5 ms.'),
    '已通过 ODBC 导入 1,250 行，耗时 42.5 毫秒。',
  );
});

void test('leaves dataset values and unknown messages untouched', () => {
  assert.equal(translateUiText('zh-CN', 'North America'), 'North America');
  assert.equal(translateUiText('zh-CN', 'revenue'), 'revenue');
});

void test('translates built-in visual, metadata, theme, and template labels', () => {
  assert.equal(translateBuiltinLabel('zh-CN', 'waterfall'), '瀑布图');
  assert.equal(translateBuiltinLabel('zh-CN', 'postal code'), '邮政编码');
  assert.equal(translateBuiltinLabel('zh-CN', 'Ocean'), '海洋');
  assert.equal(translateBuiltinLabel('zh-CN', 'Blank canvas'), '空白画布');
  assert.equal(translateBuiltinLabel('en', 'waterfall'), 'waterfall');
});
