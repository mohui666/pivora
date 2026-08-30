'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

import {
  normalizeUiLocale,
  translateUiText,
  UI_LOCALE_STORAGE_KEY,
  type UiLocale,
} from '@/lib/i18n';

type TranslationState = {
  source: string;
  rendered: string;
};

const textStates = new WeakMap<Text, TranslationState>();
const attributeStates = new WeakMap<Element, Map<string, TranslationState>>();
const TRANSLATED_ATTRIBUTES = ['aria-label', 'placeholder', 'title'] as const;

function translateTextNode(node: Text, locale: UiLocale) {
  const current = node.data;
  let state = textStates.get(node);
  if (!state || current !== state.rendered) {
    state = { source: current, rendered: current };
    textStates.set(node, state);
  }
  const translated = translateUiText(locale, state.source);
  state.rendered = translated;
  if (current !== translated) node.data = translated;
}

function translateAttributes(element: Element, locale: UiLocale) {
  let states = attributeStates.get(element);
  if (!states) {
    states = new Map();
    attributeStates.set(element, states);
  }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    let state = states.get(attribute);
    if (!state || current !== state.rendered) {
      state = { source: current, rendered: current };
      states.set(attribute, state);
    }
    const translated = translateUiText(locale, state.source);
    state.rendered = translated;
    if (current !== translated) element.setAttribute(attribute, translated);
  }
}

function translateTree(root: Node, locale: UiLocale) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root as Element;
  translateAttributes(element, locale);
  for (const child of element.childNodes) translateTree(child, locale);
}

export function useUiLocale(root: RefObject<HTMLElement | null>) {
  const [locale, setLocaleState] = useState<UiLocale>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    setLocaleState(normalizeUiLocale(stored ?? window.navigator.language));
  }, []);

  const setLocale = useCallback((next: UiLocale) => {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    document.documentElement.lang = locale;
    document.title =
      locale === 'zh-CN'
        ? 'Pivora — 本地优先分析工作室'
        : 'Pivora — Local-first analytics studio';
    translateTree(element, locale);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          translateTextNode(record.target as Text, locale);
          continue;
        }
        if (record.type === 'attributes') {
          translateAttributes(record.target as Element, locale);
          continue;
        }
        for (const node of record.addedNodes) translateTree(node, locale);
      }
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [locale, root]);

  return { locale, setLocale };
}
