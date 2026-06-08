/**
 * i18n.ts — Mark My Mind
 * Configuração e inicialização do sistema de traduções com i18next.
 * Detecta automaticamente o idioma do Obsidian via moment.locale().
 */

import i18next from "i18next";
import { moment } from "obsidian";

import en from "./locales/en.json";
import pt from "./locales/pt.json";
import zh from "./locales/zh.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";

/**
 * Mapeia o locale retornado pelo moment (ex: "pt-br", "zh-cn")
 * para a chave de recurso i18next.
 */
function resolveLocale(momentLocale: string): string {
  const lang = momentLocale.toLowerCase();
  if (lang.startsWith("pt")) return "pt";
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("ja")) return "ja";
  return "en"; // fallback padrão
}

/**
 * Inicializa o i18next com todos os locales do plugin.
 * Deve ser chamado uma única vez no onload() do plugin.
 */
export async function initI18n(): Promise<void> {
  const detectedLocale = resolveLocale(moment.locale());

  await i18next.init({
    lng: detectedLocale,
    fallbackLng: "en",
    resources: {
      en: { translation: en },
      pt: { translation: pt },
      zh: { translation: zh },
      de: { translation: de },
      es: { translation: es },
      fr: { translation: fr },
      ja: { translation: ja },
    },
    interpolation: {
      escapeValue: false, // Não é necessário em ambientes de desktop
    },
  });
}

/**
 * Função auxiliar de tradução — substitui a função t() anterior.
 * Uso: t("toolbar.reset")
 */
export function t(key: string): string {
  return i18next.t(key);
}
