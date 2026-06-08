/**
 * settings.ts
 * Definição das configurações do plugin Mark My Mind e sua aba de configurações.
 */

import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { LayoutType } from "./LayoutEngine";
import { t } from "./i18n";

export type ConnectionStyle = "curved" | "rounded" | "straight";

export interface MarkMyMindSettings {
  defaultLayout: LayoutType;
  syncDebounceMs: number;
  autoOpenForMd: boolean;
  showNoteText: boolean;
  fontSize: number;
  nodeWidth: number;
  colorMode: "level" | "branch" | "single";
  colorH1: string;
  colorH2: string;
  colorH3: string;
  colorH4: string;
  colorH5: string;
  colorH6: string;
  colorH7: string;
  colorH8: string;
  connectionStyle: ConnectionStyle;
  maxNodeHeight: number;
  connectionWidth: number;
  autoFocusOnSelect: boolean;
  singleH1Root: boolean;
  textAlign: "titleCenter" | "left" | "center" | "right";
}

export const DEFAULT_SETTINGS: MarkMyMindSettings = {
  defaultLayout: "right",
  syncDebounceMs: 500,
  autoOpenForMd: false,
  showNoteText: true,
  fontSize: 16,
  nodeWidth: 0,
  colorMode: "branch",
  colorH1: "#6366f1",
  colorH2: "#8b5cf6",
  colorH3: "#06b6d4",
  colorH4: "#10b981",
  colorH5: "#f59e0b",
  colorH6: "#ef4444",
  colorH7: "#ec4899",
  colorH8: "#a855f7",
  connectionStyle: "rounded",
  maxNodeHeight: 350,
  connectionWidth: 5,
  autoFocusOnSelect: true,
  singleH1Root: true,
  textAlign: "titleCenter",
};

export class MarkMyMindSettingTab extends PluginSettingTab {
  plugin: Plugin & { settings: MarkMyMindSettings; saveSettings: () => Promise<void> };

  constructor(
    app: App,
    plugin: Plugin & { settings: MarkMyMindSettings; saveSettings: () => Promise<void> }
  ) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: t("settings.title") });

    // ── Layout padrão ──
    new Setting(containerEl)
      .setName(t("settings.layout.name"))
      .setDesc(t("settings.layout.desc"))
      .addDropdown((drop) =>
        drop
          .addOption("right", t("settings.layout.right"))
          .addOption("down", t("settings.layout.down"))
          .addOption("bidirectional", t("settings.layout.bidirectional"))
          .addOption("up", t("settings.layout.up"))
          .setValue(this.plugin.settings.defaultLayout)
          .onChange(async (value) => {
            this.plugin.settings.defaultLayout = value as LayoutType;
            await this.plugin.saveSettings();
          })
      );

    // ── Estilo de linhas de conexão (Line Form) ──
    new Setting(containerEl)
      .setName(t("settings.lineForm.name"))
      .setDesc(t("settings.lineForm.desc"))
      .addDropdown((drop) =>
        drop
          .addOption("curved", t("settings.lineForm.curved"))
          .addOption("rounded", t("settings.lineForm.rounded"))
          .addOption("straight", t("settings.lineForm.straight"))
          .setValue(this.plugin.settings.connectionStyle || "rounded")
          .onChange(async (value) => {
            this.plugin.settings.connectionStyle = value as ConnectionStyle;
            await this.plugin.saveSettings();
          })
      );

    // ── Debounce de sincronização ──
    new Setting(containerEl)
      .setName(t("settings.syncSpeed.name"))
      .setDesc(t("settings.syncSpeed.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(200, 2000, 100)
          .setValue(this.plugin.settings.syncDebounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.syncDebounceMs = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Auto-abrir ──
    new Setting(containerEl)
      .setName(t("settings.autoOpen.name"))
      .setDesc(t("settings.autoOpen.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenForMd)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenForMd = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Mostrar nota dos headings ──
    new Setting(containerEl)
      .setName(t("settings.showNoteText.name"))
      .setDesc(t("settings.showNoteText.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNoteText)
          .onChange(async (value) => {
            this.plugin.settings.showNoteText = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Focar automaticamente no selecionado (Auto Focus) ──
    new Setting(containerEl)
      .setName(t("settings.autoFocusOnSelect.name"))
      .setDesc(t("settings.autoFocusOnSelect.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoFocusOnSelect)
          .onChange(async (value) => {
            this.plugin.settings.autoFocusOnSelect = value;
            await this.plugin.saveSettings();
          })
      );

    // ── H1 como Nó Único ──
    new Setting(containerEl)
      .setName(t("settings.singleH1Root.name"))
      .setDesc(t("settings.singleH1Root.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.singleH1Root)
          .onChange(async (value) => {
            this.plugin.settings.singleH1Root = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Alinhamento do texto nos blocos ──
    new Setting(containerEl)
      .setName(t("settings.alignment.name"))
      .setDesc(t("settings.alignment.desc"))
      .addDropdown((drop) =>
        drop
          .addOption("titleCenter", t("alignment.titleCenter"))
          .addOption("left", t("alignment.left"))
          .addOption("center", t("alignment.center"))
          .addOption("right", t("alignment.right"))
          .setValue(this.plugin.settings.textAlign || "titleCenter")
          .onChange(async (value) => {
            this.plugin.settings.textAlign = value as any;
            await this.plugin.saveSettings();
          })
      );

    // ── Limitar tamanho do bloco (Max Height Limit) ──
    new Setting(containerEl)
      .setName(t("settings.maxHeight.name"))
      .setDesc(t("settings.maxHeight.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 800, 50)
          .setValue(this.plugin.settings.maxNodeHeight || 0)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxNodeHeight = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Tamanho da fonte ──
    new Setting(containerEl)
      .setName(t("settings.fontSize.name"))
      .setDesc(t("settings.fontSize.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(10, 24, 1)
          .setValue(this.plugin.settings.fontSize || 12)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Largura do bloco ──
    new Setting(containerEl)
      .setName(t("settings.nodeWidth.name"))
      .setDesc(t("settings.nodeWidth.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 800, 50)
          .setValue(this.plugin.settings.nodeWidth !== undefined ? this.plugin.settings.nodeWidth : 0)
          .setDynamicTooltip()
          .onChange(async (value) => {
            let finalValue = value;
            if (value > 0 && value < 200) {
              finalValue = 200;
              slider.setValue(200);
            }
            this.plugin.settings.nodeWidth = finalValue;
            await this.plugin.saveSettings();
          })
      );

    // ── Espessura das linhas (Line Size) ──
    new Setting(containerEl)
      .setName(t("settings.lineSize.name"))
      .setDesc(t("settings.lineSize.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.connectionWidth !== undefined ? this.plugin.settings.connectionWidth : 5)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.connectionWidth = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Modo de cores ──
    new Setting(containerEl)
      .setName(t("settings.colorMode.name"))
      .setDesc(t("settings.colorMode.desc"))
      .addDropdown((drop) =>
        drop
          .addOption("level", t("settings.colorMode.byLevel"))
          .addOption("branch", t("settings.colorMode.byBranch"))
          .addOption("single", t("settings.colorMode.single"))
          .setValue(this.plugin.settings.colorMode || "level")
          .onChange(async (value) => {
            this.plugin.settings.colorMode = value as any;
            await this.plugin.saveSettings();
          })
      );

    // ── Cores por nível ──
    containerEl.createEl("h3", { text: t("settings.colors.title") });

    const colorSettings: { key: keyof MarkMyMindSettings; name: string }[] = [
      { key: "colorH1", name: t("settings.colors.h1") },
      { key: "colorH2", name: t("settings.colors.h2") },
      { key: "colorH3", name: t("settings.colors.h3") },
      { key: "colorH4", name: t("settings.colors.h4") },
    ];

    for (const { key, name } of colorSettings) {
      new Setting(containerEl)
        .setName(name)
        .addColorPicker((picker) =>
          picker
            .setValue(this.plugin.settings[key] as string)
            .onChange(async (value) => {
              (this.plugin.settings[key] as string) = value;
              await this.plugin.saveSettings();
            })
        );
    }
  }
}
