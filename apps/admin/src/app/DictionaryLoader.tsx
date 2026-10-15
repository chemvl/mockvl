import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  // getLanguagesOptions,
  // getTransifyOptions,
} from '@/client/@tanstack/react-query.gen';
import { useAppStore } from '@/store';

/**
 * Single mount point that loads runtime translations and supported languages
 * from the backend and pushes them into the store. Mounted in main.tsx.
 *
 * getTransify: GET /transify?lang={locale} → { [key: string]: string }
 * getLanguages: GET /transify/language → Array<{ id, name }>
 * Translations fall back to defaultLang.ts until the API resolves.
 */
export function DictionaryLoader() {
  const locale = useAppStore((s) => s.locale);
  const setApiMessages = useAppStore((s) => s.setApiMessages);
  const setLanguages = useAppStore((s) => s.setLanguages);

  // const { data: transify } = useQuery({
  //   ...getTransifyOptions({ query: { lang: locale } }),
  // });

  // const { data: languages } = useQuery({
  //   ...getLanguagesOptions(),
  //   staleTime: Infinity,
  // });

  // useEffect(() => {
  //   if (transify && Object.keys(transify).length) {
  //     setApiMessages(transify as Record<string, string>);
  //   }
  // }, [transify, setApiMessages]);

  // useEffect(() => {
  //   if (languages?.length) setLanguages(languages);
  // }, [languages, setLanguages]);

  return null;
}
