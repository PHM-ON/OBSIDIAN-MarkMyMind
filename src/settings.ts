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
  autoExpandSelected: boolean;
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
  autoExpandSelected: false,
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

    new Setting(containerEl).setName(t("settings.title")).setHeading();

    // ─── GRUPO 1: GERAL ───
    new Setting(containerEl).setName(t("settings.groupGeneral")).setHeading();

    // 1º. Auto-abrir (autoOpenForMd)
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

    // 2º. Debounce de sincronização (syncDebounceMs)
    new Setting(containerEl)
      .setName(t("settings.syncSpeed.name"))
      .setDesc(t("settings.syncSpeed.desc"))
      .addDropdown((drop) =>
        drop
          .addOption("200", "200ms")
          .addOption("500", "500ms")
          .addOption("800", "800ms")
          .addOption("1000", "1000ms (1s)")
          .addOption("1500", "1500ms")
          .addOption("2000", "2000ms (2s)")
          .setValue(String(this.plugin.settings.syncDebounceMs))
          .onChange(async (value) => {
            this.plugin.settings.syncDebounceMs = parseInt(value);
            await this.plugin.saveSettings();
          })
      );

    // 3. Focar automaticamente no selecionado (Auto Focus)
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

    // ─── GRUPO 2: LAYOUT & LINHAS ───
    new Setting(containerEl).setName(t("settings.groupLayout")).setHeading();

    // Layout padrão
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

    // Estilo de linhas de conexão (Line Form)
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

    // Espessura das linhas (Line Size)
    new Setting(containerEl)
      .setName(t("settings.lineSize.name"))
      .setDesc(t("settings.lineSize.desc"))
      .addDropdown((drop) => {
        for (let i = 1; i <= 10; i++) {
          drop.addOption(String(i), `${i}px`);
        }
        drop.setValue(String(this.plugin.settings.connectionWidth !== undefined ? this.plugin.settings.connectionWidth : 5))
            .onChange(async (value) => {
              this.plugin.settings.connectionWidth = parseInt(value);
              await this.plugin.saveSettings();
            });
      });

    // H1 como Nó Único (Múltiplos Blocos Principais)
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

    // ─── GRUPO 3: ESTILO DOS BLOCOS ───
    new Setting(containerEl).setName(t("settings.groupBlocks")).setHeading();

    // Tamanho da fonte
    new Setting(containerEl)
      .setName(t("settings.fontSize.name"))
      .setDesc(t("settings.fontSize.desc"))
      .addDropdown((drop) => {
        for (let i = 10; i <= 24; i++) {
          drop.addOption(String(i), `${i}px`);
        }
        drop.setValue(String(this.plugin.settings.fontSize || 12))
            .onChange(async (value) => {
              this.plugin.settings.fontSize = parseInt(value);
              await this.plugin.saveSettings();
            });
      });

    // Largura do bloco
    new Setting(containerEl)
      .setName(t("settings.nodeWidth.name"))
      .setDesc(t("settings.nodeWidth.desc"))
      .addDropdown((drop) => {
        drop.addOption("0", t("width.auto"));
        for (let w = 200; w <= 800; w += 50) {
          drop.addOption(String(w), `${w}px`);
        }
        drop.setValue(String(this.plugin.settings.nodeWidth !== undefined ? this.plugin.settings.nodeWidth : 0))
            .onChange(async (value) => {
              this.plugin.settings.nodeWidth = parseInt(value);
              await this.plugin.saveSettings();
            });
      });

    // Limitar tamanho do bloco (Max Height Limit)
    new Setting(containerEl)
      .setName(t("settings.maxHeight.name"))
      .setDesc(t("settings.maxHeight.desc"))
      .addDropdown((drop) => {
        drop.addOption("0", t("height.noLimit"));
        for (let h = 100; h <= 800; h += 50) {
          drop.addOption(String(h), `${h}px`);
        }
        drop.setValue(String(this.plugin.settings.maxNodeHeight || 0))
            .onChange(async (value) => {
              this.plugin.settings.maxNodeHeight = parseInt(value);
              await this.plugin.saveSettings();
            });
      });

    // Alinhamento do texto nos blocos
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
            this.plugin.settings.textAlign = value as "titleCenter" | "left" | "center" | "right";
            await this.plugin.saveSettings();
          })
      );

    // Mostrar nota dos headings
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

    // ─── GRUPO 4: CORES ───
    new Setting(containerEl).setName(t("settings.colors.title")).setHeading();

    // Modo de cores
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
            this.plugin.settings.colorMode = value as "level" | "branch" | "single";
            await this.plugin.saveSettings();
          })
      );

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
