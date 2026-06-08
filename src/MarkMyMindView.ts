/**
 * MarkMyMindView.ts
 * View principal do plugin: split screen com editor Markdown + canvas MindMap.
 * Ambos se sincronizam bidirecionalmente em tempo real.
 */

import { ItemView, WorkspaceLeaf, TFile, Notice, TAbstractFile, ViewStateResult, Modal, App, setIcon, setTooltip, debounce } from "obsidian";
import {
  parseMarkdown, MindNode,
  updateNodeContent, findNodeById,
  getLevelColor, deleteNodeById, moveNodeInTree, recalcLevels
} from "./MarkdownParser";
import { mindMapToMarkdown } from "./MindMapToMd";
import { MindMapEngine } from "./MindMapEngine";
import { LayoutType, normalizeLayout } from "./LayoutEngine";
import { MarkMyMindSettings, DEFAULT_SETTINGS } from "./settings";
import { t } from "./i18n";

export const MARKMYMIND_VIEW_TYPE = "markmymind-on-view";

export class MarkMyMindView extends ItemView {
  file: TFile | null = null;
  settings: MarkMyMindSettings;
  engine: MindMapEngine | null = null;
  currentRoot: MindNode | null = null;
  currentLayout: LayoutType;
  private currentMdContent = "";
  private isSyncing = false;
  private debouncedReload: any;

  private maxHistorySize = 100;
  // DOM
  private canvasEl!: HTMLElement;
  private toolbar!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private levelBtns: HTMLButtonElement[] = [];
  private splitBtn: HTMLButtonElement | null = null;
  private selectedBtn: HTMLButtonElement | null = null;
  private titlesBtn: HTMLButtonElement | null = null;
  private singleH1RootBtn: HTMLButtonElement | null = null;

  saveSettings: () => Promise<void>;
  plugin: any;

  constructor(leaf: WorkspaceLeaf, settings: MarkMyMindSettings, saveSettings: () => Promise<void>, plugin?: any) {
    super(leaf);
    this.navigation = true; // Informa ao Obsidian que esta view suporta navegação de arquivos
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.plugin = plugin;
    this.currentLayout = normalizeLayout(settings.defaultLayout);
  }

  getViewType(): string  { return MARKMYMIND_VIEW_TYPE; }
  getDisplayText(): string { return this.file ? this.file.basename : "Mark My Mind"; }
  getIcon(): string { return "brain-circuit"; }


  async onOpen(): Promise<void> {
    this.debouncedReload = debounce(
      (file: TFile) => this.reloadFromVault(file),
      this.settings.syncDebounceMs || 500,
      true
    );
    this.buildUI();
    this.registerVaultSync();
    this.registerUndoRedoKeys();
  }

  async onClose(): Promise<void> {
    if (this.engine) { this.engine.destroy(); this.engine = null; }
    if (this.file && this.plugin) {
      this.plugin.cleanupSplitLeaf(this.file.path, this.leaf);
    }
  }

  // ─── Sincronização com a nota original do Obsidian ─────────────────────────

  private registerVaultSync(): void {
    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (file instanceof TFile && file === this.file && !this.isSyncing) {
          this.debouncedReload(file);
        }
      })
    );
  }

  private async reloadFromVault(file: TFile): Promise<void> {
    const newContent = await this.app.vault.cachedRead(file);
    if (newContent !== this.currentMdContent) {
      this.currentMdContent = newContent;
      this.syncMdToMap(newContent, false);
      this.setStatus("🔄 Atualizado do vault");
    }
  }

  /** Carrega um arquivo no mapa */
  async loadFile(file: TFile): Promise<void> {
    this.file = file;
    const content = await this.app.vault.cachedRead(file);
    this.currentMdContent = content;
    this.syncMdToMap(content, true);
    (this.leaf as any).updateHeader();

    if (this.splitBtn) {
      if (this.plugin?.isSplitActive?.(file.path)) {
        this.splitBtn.addClass("active");
      } else {
        this.splitBtn.removeClass("active");
      }
    }
  }

  // ─── Build da Interface ────────────────────────────────────────────────────

  private buildUI(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("markmymind-view");

    this.toolbar = root.createDiv({ cls: "markmymind-toolbar-top-floating" });
    this.buildToolbar(this.toolbar);

    // Canvas do mapa mental em tela cheia na View
    this.canvasEl = root.createDiv({ cls: "markmymind-canvas" });
    this.canvasEl.addEventListener("markmymind-canvas-click", () => {
      if (this.sidebarEl) {
        this.sidebarEl.querySelectorAll(".markmymind-sidebar-flyout.show").forEach(f => f.removeClass("show"));
        this.sidebarEl.querySelectorAll(".markmymind-sidebar-btn.active").forEach(b => b.removeClass("active"));
      }
    });

    // Barra lateral de configurações de acesso rápido (Photoshop-style)
    this.sidebarEl = root.createDiv({ cls: "markmymind-sidebar-right" });
    this.buildSidebar(this.sidebarEl);

    // Fechar todos os menus ativos ao clicar em qualquer lugar da tela
    this.registerDomEvent(document, "click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Se clicou no popover de cores ou no input de cores nativo, ignora para não fechar o submenu
      if (target.closest(".markmymind-palette-popover") || (target.tagName === "INPUT" && (target as HTMLInputElement).type === "color")) {
        return;
      }
      
      // Fechar flyouts da sidebar se clicou fora da barra lateral
      if (this.sidebarEl && !this.sidebarEl.contains(target)) {
        this.sidebarEl.querySelectorAll(".markmymind-sidebar-flyout.show").forEach(f => f.classList.remove("show"));
        this.sidebarEl.querySelectorAll(".markmymind-sidebar-btn.active").forEach(b => b.classList.remove("active"));
      }

      // Fechar o dropdown de levels se clicou fora do level wrap e do dropdown
      if (this.toolbar) {
        const levelWrapEl = this.toolbar.querySelector(".markmymind-toolbar-level-wrap");
        const dropdown = this.contentEl.querySelector(".markmymind-toolbar-level-dropdown");
        const isClickInsideBtn = levelWrapEl && levelWrapEl.contains(target);
        const isClickInsideDropdown = dropdown && dropdown.contains(target);
        
        if (!isClickInsideBtn && !isClickInsideDropdown) {
          const btn = levelWrapEl?.querySelector(".markmymind-toolbar-level-btn");
          if (dropdown) dropdown.classList.remove("show");
          if (btn) btn.classList.remove("active");
        }
      }
    });

    this.initEngine();

    // Bloqueia o resize do mapa quando o usuário está editando um nó inline,
    // para evitar que o resize do Android (ao abrir teclado) quebre o layout
    const resizeObs = new ResizeObserver(() => {
      if (!this.engine?.isEditing) {
        this.engine?.resize();
      }
    });
    resizeObs.observe(this.canvasEl);
    this.register(() => resizeObs.disconnect());
  }

  private buildToolbar(toolbar: HTMLElement): void {
    const undoBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn",
    });
    setIcon(undoBtn, "undo");
    setTooltip(undoBtn, t("toolbar.undo"));
    undoBtn.addEventListener("click", () => this.undo());

    const redoBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn",
    });
    setIcon(redoBtn, "redo");
    setTooltip(redoBtn, t("toolbar.redo"));
    redoBtn.addEventListener("click", () => this.redo());

    toolbar.createDiv({ cls: "markmymind-toolbar-sep" });

    // 1. Grupo de Foco (Focus: Reset | Fit | Selected) - Acesso rápido
    const resetBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn",
    });
    setIcon(resetBtn, "refresh-cw");
    setTooltip(resetBtn, `${t("toolbar.focus")} ${t("toolbar.reset")}`);
    resetBtn.addEventListener("click", () => this.engine?.centerView());

    const fitBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn",
    });
    setIcon(fitBtn, "maximize");
    setTooltip(fitBtn, `${t("toolbar.focus")} ${t("toolbar.fit")}`);
    fitBtn.addEventListener("click", () => this.engine?.fitView());

    this.selectedBtn = toolbar.createEl("button", {
      cls: `markmymind-toolbar-btn ${this.settings.autoFocusOnSelect ? "active" : ""}`,
    });
    setIcon(this.selectedBtn, "mouse-pointer");
    setTooltip(this.selectedBtn, t("toolbar.selectedTooltip"));
    this.selectedBtn.addEventListener("click", async () => {
      this.settings.autoFocusOnSelect = !this.settings.autoFocusOnSelect;
      this.selectedBtn?.classList.toggle("active", this.settings.autoFocusOnSelect);
      await this.saveSettings();
      if (this.settings.autoFocusOnSelect) {
        this.engine?.focusOnSelected();
      }
    });

    toolbar.createDiv({ cls: "markmymind-toolbar-sep" });

    // 3. Apenas Títulos (📑) - Acesso rápido e H1 Único como Raiz (🌳)
    this.titlesBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn",
    });
    setIcon(this.titlesBtn, "type");
    this.updateTitlesBtnVisual();

    this.titlesBtn.addEventListener("click", async () => {
      await this.cycleTitlesState();
    });

    this.singleH1RootBtn = toolbar.createEl("button", {
      cls: `markmymind-toolbar-btn ${this.settings.singleH1Root ? "active" : ""}`,
    });
    setIcon(this.singleH1RootBtn, "folder-tree");
    setTooltip(this.singleH1RootBtn, t("toolbar.singleH1RootTooltip"));

    this.singleH1RootBtn.addEventListener("click", async () => {
      this.settings.singleH1Root = !this.settings.singleH1Root;
      this.singleH1RootBtn?.classList.toggle("active", this.settings.singleH1Root);
      await this.saveSettings();
      this.syncMdToMap(this.currentMdContent, false);
      this.engine?.fitView();
    });

    toolbar.createDiv({ cls: "markmymind-toolbar-sep" });

    // 4. Level — botão na toolbar com hover-open
    const levelWrap = toolbar.createDiv({ cls: "markmymind-toolbar-level-wrap" });
    const toolbarLevelBtn = levelWrap.createEl("button", {
      cls: "markmymind-toolbar-btn markmymind-toolbar-level-btn",
    });
    setIcon(toolbarLevelBtn, "network");
    setTooltip(toolbarLevelBtn, t("toolbar.level"));

    const levelDropdown = this.contentEl.createDiv({ cls: "markmymind-toolbar-level-dropdown" });
    
    // Adiciona o label com tooltip explicativo (ⓘ)
    const levelLabel = levelDropdown.createDiv({ cls: "markmymind-flyout-section-label" });
    levelLabel.setText(t("toolbar.level"));
    levelLabel.createEl("span", { cls: "markmymind-flyout-label-icon", text: " ⓘ" });
    setTooltip(levelLabel, t("toolbar.levelTooltip"));

    const levelSegmented = levelDropdown.createDiv({ cls: "markmymind-level-segmented" });
    this.levelBtns = [];
    const levelOpts = ["0", "1", "2", "3", "4", "5", "6", "all"];

    for (const opt of levelOpts) {
      const isAll = opt === "all";
      const btnText = isAll ? t("toolbar.all").substring(0, 3) : opt;
      const lb = levelSegmented.createEl("button", {
        cls: `markmymind-btn markmymind-level-btn ${isAll ? "active" : ""}`,
        text: btnText,
      });
      lb.dataset.level = opt;
      lb.addEventListener("click", () => {
        this.levelBtns.forEach(b => b.removeClass("active"));
        lb.addClass("active");
        if (!this.currentRoot) return;
        if (isAll) {
          this.expandAllNodes(this.currentRoot);
        } else {
          this.collapseTreeByLevel(this.currentRoot, parseInt(opt));
        }
        this.engine?.render(this.currentRoot, this.currentLayout);
        setTimeout(() => this.engine?.fitView(), 50);
      });
      this.levelBtns.push(lb);
    }

    // Click: toggle (1 clique abre, 1 clique fecha)
    toolbarLevelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isShow = levelDropdown.hasClass("show");
      if (isShow) {
        levelDropdown.removeClass("show");
        toolbarLevelBtn.removeClass("active");
      } else {
        const btnRect = toolbarLevelBtn.getBoundingClientRect();
        const contentRect = this.contentEl.getBoundingClientRect();
        levelDropdown.style.top = `${btnRect.bottom - contentRect.top + 6}px`;
        levelDropdown.style.left = `${btnRect.left + (btnRect.width / 2) - contentRect.left}px`;
        
        levelDropdown.addClass("show");
        toolbarLevelBtn.addClass("active");
      }
    });

    toolbar.createDiv({ cls: "markmymind-toolbar-sep" });

    // Botão Voltar para o Editor (📝)
    const backBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn markmymind-save-btn",
    });
    setIcon(backBtn, "file-text");
    setTooltip(backBtn, t("toolbar.backToEditor"));
    backBtn.addEventListener("click", async () => {
      if (this.file) {
        if (this.plugin) {
          this.plugin.markdownModeFiles.add(this.file.path);
        }
        await this.leaf.setViewState({
          type: "markdown",
          state: { file: this.file.path },
          active: true,
        });
      }
    });

    // Botão Split Tela (Editor + MindMap)
    this.splitBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn",
    });
    setIcon(this.splitBtn, "columns-2");
    setTooltip(this.splitBtn, t("toolbar.splitView"));
    this.splitBtn.addEventListener("click", async () => {
      if (!this.file) return;
      if (this.plugin) {
        await this.plugin.toggleSplitView(this.file, this.leaf);
      }
    });

    toolbar.createDiv({ cls: "markmymind-toolbar-sep" });

    // Botão de Apoio/Doação (❤️)
    const donateBtn = toolbar.createEl("button", {
      cls: "markmymind-toolbar-btn markmymind-btn markmymind-donate-btn",
    });
    setIcon(donateBtn, "heart");
    setTooltip(donateBtn, t("toolbar.donate"));
    donateBtn.addEventListener("click", () => {
      new DonationModal(this.app).open();
    });
  }

  private createSidebarBtn(parent: HTMLElement, iconId: string, tooltipText: string, onClick: (btn: HTMLButtonElement, event: MouseEvent) => void): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: "markmymind-sidebar-btn" });
    setIcon(btn, iconId);
    setTooltip(btn, tooltipText);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(btn, e);
    });
    return btn;
  }

  private toggleFlyout(btn: HTMLButtonElement, flyout: HTMLElement): void {
    const isShowing = flyout.hasClass("show");
    
    // Fecha todos os outros flyouts
    this.sidebarEl.querySelectorAll(".markmymind-sidebar-flyout").forEach(f => f.removeClass("show"));
    this.sidebarEl.querySelectorAll(".markmymind-sidebar-btn").forEach(b => b.removeClass("active"));
    
    if (!isShowing) {
      flyout.addClass("show");
      btn.addClass("active");
    }
  }

  private createFlyout(btn: HTMLButtonElement, titleText: string): HTMLDivElement {
    const flyout = btn.createDiv({ cls: "markmymind-sidebar-flyout" });
    
    // Impede que eventos dentro do flyout triggerem o clique do botão pai
    flyout.addEventListener("mousedown", (e) => e.stopPropagation());
    flyout.addEventListener("click", (e) => e.stopPropagation());
    
    const title = flyout.createDiv({ cls: "markmymind-sidebar-flyout-title" });
    title.createEl("strong", { text: titleText });
    
    return flyout;
  }

  private createFlyoutRow(flyout: HTMLElement, labelText: string, emoji = "", onReset?: () => void): HTMLDivElement {
    const row = flyout.createDiv({ cls: "markmymind-sidebar-flyout-row" });
    
    const content = row.createDiv({ cls: "markmymind-popover-row-content" });

    if (onReset) {
      const resetBtn = row.createEl("button", {
        cls: "markmymind-btn markmymind-reset-btn",
        title: t("popover.restoreDefault")
      });
      setIcon(resetBtn, "reset");
      resetBtn.addEventListener("click", onReset);
    }
    
    return content;
  }

  private buildSidebar(sidebar: HTMLElement): void {
    // ── Helper: adiciona label com tooltip dentro do flyout ──────────────────
    const addLabel = (parent: HTMLElement, text: string, tooltip: string) => {
      const lbl = parent.createDiv({ cls: "markmymind-flyout-section-label" });
      lbl.setText(text);
      lbl.createEl("span", { cls: "markmymind-flyout-label-icon", text: " ⓘ" });
      setTooltip(lbl, tooltip);
    };

    // ── Helper: registra clique para abrir flyout ────────────────────────────
    const addHoverFlyout = (btn: HTMLButtonElement, flyout: HTMLElement) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleFlyout(btn, flyout);
      });
    };

    // ════════════════════════════════════════════════════════════
    // 1. LAYOUT — Layout + Color Mode agrupados
    // ════════════════════════════════════════════════════════════
    const layoutColorsBtn = this.createSidebarBtn(sidebar, "layout-grid", t("popover.layout"), (btn) => {
      // clique gerenciado pelo addHoverFlyout
    });
    const layoutColorsFlyout = this.createFlyout(layoutColorsBtn, t("popover.layout"));
    addHoverFlyout(layoutColorsBtn, layoutColorsFlyout);

    // — Sub: Layout
    addLabel(layoutColorsFlyout, t("popover.layout"), t("popover.layoutTooltip"));
    const layoutOptions = [
      { value: "right", text: t("layout.right") },
      { value: "down", text: t("layout.down") },
      { value: "bidirectional", text: t("layout.bidirectional") },
      { value: "up", text: t("layout.up") },
    ];
    const layoutGrid = layoutColorsFlyout.createDiv({ cls: "markmymind-grid-options" });
    const layoutBtns: HTMLButtonElement[] = [];
    layoutOptions.forEach((opt) => {
      const btn = layoutGrid.createEl("button", {
        cls: `markmymind-btn markmymind-option-btn ${this.currentLayout === opt.value ? "active" : ""}`,
        text: opt.text
      });
      btn.dataset.value = opt.value;
      btn.addEventListener("click", () => {
        layoutBtns.forEach(b => b.removeClass("active"));
        btn.addClass("active");
        this.setLayout(opt.value as LayoutType);
      });
      layoutBtns.push(btn);
    });

    // — Divisor visual
    layoutColorsFlyout.createDiv({ cls: "markmymind-flyout-divider" });

    // — Sub: Color Mode
    addLabel(layoutColorsFlyout, t("popover.colors"), t("popover.colorsTooltip"));
    const colorOptions = [
      { value: "level", text: t("colorMode.byLevel") },
      { value: "branch", text: t("colorMode.byBranch") },
      { value: "single", text: t("colorMode.fixed") },
    ];
    const colorGrid = layoutColorsFlyout.createDiv({ cls: "markmymind-grid-options" });
    const colorBtns: HTMLButtonElement[] = [];
    colorOptions.forEach((opt) => {
      const btn = colorGrid.createEl("button", {
        cls: `markmymind-btn markmymind-option-btn ${(this.settings.colorMode || "level") === opt.value ? "active" : ""}`,
        text: opt.text
      });
      btn.addEventListener("click", async () => {
        colorBtns.forEach(b => b.removeClass("active"));
        btn.addClass("active");
        this.settings.colorMode = opt.value as any;
        await this.saveSettings();
        renderColorPickers();
        if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
      });
      colorBtns.push(btn);
    });

    const colorPickerContainer = layoutColorsFlyout.createDiv({ cls: "markmymind-color-pickers-container" });
    colorPickerContainer.style.cssText = "display:flex; flex-direction:column; gap:8px; margin-top:8px; align-items:center; width:100%; position:relative;";

    const renderColorPickers = () => {
      colorPickerContainer.empty();
      
      const mode = this.settings.colorMode || "level";
      let pickers: { key: "colorH1" | "colorH2" | "colorH3" | "colorH4" | "colorH5" | "colorH6" | "colorH7" | "colorH8"; label: string; defaultVal: string }[] = [];
      
      if (mode === "level") {
        pickers = [
          { key: "colorH1", label: "H1", defaultVal: "#6366f1" },
          { key: "colorH2", label: "H2", defaultVal: "#8b5cf6" },
          { key: "colorH3", label: "H3", defaultVal: "#06b6d4" },
          { key: "colorH4", label: "H4", defaultVal: "#10b981" },
          { key: "colorH5", label: "H5", defaultVal: "#f59e0b" },
          { key: "colorH6", label: "H6", defaultVal: "#ef4444" },
          { key: "colorH7", label: "L1", defaultVal: "#ec4899" },
          { key: "colorH8", label: "L2", defaultVal: "#a855f7" },
        ];
      } else if (mode === "branch") {
        pickers = [
          { key: "colorH1", label: "Raiz", defaultVal: "#6366f1" },
          { key: "colorH2", label: "R1", defaultVal: "#8b5cf6" },
          { key: "colorH3", label: "R2", defaultVal: "#06b6d4" },
          { key: "colorH4", label: "R3", defaultVal: "#10b981" },
          { key: "colorH5", label: "R4", defaultVal: "#f59e0b" },
          { key: "colorH6", label: "R5", defaultVal: "#ef4444" },
          { key: "colorH7", label: "R6", defaultVal: "#ec4899" },
          { key: "colorH8", label: "R7", defaultVal: "#a855f7" },
        ];
      } else if (mode === "single") {
        pickers = [
          { key: "colorH1", label: "Raiz", defaultVal: "#6366f1" },
          { key: "colorH2", label: "Fixo", defaultVal: "#8b5cf6" },
        ];
      }

      const maxCols = 4;
      const rowsCount = Math.ceil(pickers.length / maxCols);

      for (let r = 0; r < rowsCount; r++) {
        const rowDiv = colorPickerContainer.createDiv();
        rowDiv.style.cssText = "display:flex; gap:10px; justify-content:center; align-items:center; width:100%;";
        
        const rowItems = pickers.slice(r * maxCols, (r + 1) * maxCols);
        
        rowItems.forEach((p) => {
          const wrap = rowDiv.createDiv();
          wrap.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:2px; position:relative; min-width:42px;";
          
          const pickWrap = wrap.createDiv();
          pickWrap.style.cssText = "display:flex; align-items:center; gap:3px; position:relative;";

          const colorBadge = pickWrap.createDiv();
          const currentColor = this.settings[p.key] || p.defaultVal;
          colorBadge.style.cssText = `
            width: 20px;
            height: 20px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 50%;
            cursor: pointer;
            background-color: ${currentColor};
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            transition: transform 0.1s ease;
          `;
          
          colorBadge.addEventListener("click", (e) => {
            e.stopPropagation();
            this.showColorPalettePopover(colorBadge, p.key, p.defaultVal, async (newColor) => {
              this.settings[p.key] = newColor;
              colorBadge.style.backgroundColor = newColor;
              await this.saveSettings();
              if (this.currentRoot) {
                this.engine?.render(this.currentRoot, this.currentLayout);
              }
            });
          });

          const resetBtn = pickWrap.createEl("button", {
            cls: "markmymind-btn markmymind-reset-btn",
          });
          resetBtn.style.cssText = `
            width: 14px;
            height: 14px;
            min-height: 14px;
            min-width: 14px;
            padding: 0;
            font-size: 8px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: rgba(255, 255, 255, 0.15);
            color: var(--text-muted);
            cursor: pointer;
            opacity: 0.7;
            margin: 0;
          `;
          resetBtn.innerHTML = "↺";
          setTooltip(resetBtn, "Resetar");
          
          resetBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.settings[p.key] = p.defaultVal;
            colorBadge.style.backgroundColor = p.defaultVal;
            await this.saveSettings();
            if (this.currentRoot) {
              this.engine?.render(this.currentRoot, this.currentLayout);
            }
          });
          
          const label = wrap.createEl("span", {
            text: p.label,
          });
          label.style.cssText = "font-size: 9px; color: var(--text-muted); font-weight: 500;";
        });
      }
    };

    renderColorPickers();

    // ════════════════════════════════════════════════════════════
    // 2. LINE FORM — Estilo + Espessura agrupados
    // ════════════════════════════════════════════════════════════
    const linesBtn = this.createSidebarBtn(sidebar, "git-branch", t("popover.lineForm"), (btn) => {
      // clique gerenciado pelo addHoverFlyout
    });
    const linesFlyout = this.createFlyout(linesBtn, t("popover.lineForm"));
    addHoverFlyout(linesBtn, linesFlyout);

    // — Sub: Line Shape
    addLabel(linesFlyout, t("popover.lines"), t("popover.linesTooltip"));
    const linesOptions = [
      { value: "curved", text: t("lineStyle.curved") },
      { value: "rounded", text: t("lineStyle.rounded") },
      { value: "straight", text: t("lineStyle.straight") },
    ];
    const linesGrid = linesFlyout.createDiv({ cls: "markmymind-grid-options" });
    const linesBtns: HTMLButtonElement[] = [];
    linesOptions.forEach((opt) => {
      const btn = linesGrid.createEl("button", {
        cls: `markmymind-btn markmymind-option-btn ${(this.settings.connectionStyle || "rounded") === opt.value ? "active" : ""}`,
        text: opt.text
      });
      btn.addEventListener("click", async () => {
        linesBtns.forEach(b => b.removeClass("active"));
        btn.addClass("active");
        this.settings.connectionStyle = opt.value as any;
        await this.saveSettings();
        if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
      });
      linesBtns.push(btn);
    });

    // — Divisor visual
    linesFlyout.createDiv({ cls: "markmymind-flyout-divider" });

    // — Sub: Line Size (espessura)
    addLabel(linesFlyout, t("popover.thickness"), t("popover.thicknessTooltip"));
    let thicknessSelect: HTMLSelectElement;
    const thicknessContent = this.createFlyoutRow(linesFlyout, t("popover.thickness"), "📏", async () => {
      this.settings.connectionWidth = DEFAULT_SETTINGS.connectionWidth;
      await this.saveSettings();
      thicknessSelect.value = String(DEFAULT_SETTINGS.connectionWidth);
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });
    thicknessSelect = thicknessContent.createEl("select", { cls: "markmymind-select" }) as HTMLSelectElement;
    for (let w = 1; w <= 10; w++) {
      const opt = thicknessSelect.createEl("option", { value: String(w), text: `${w}px` });
      if (w === (this.settings.connectionWidth !== undefined ? this.settings.connectionWidth : 5)) {
        opt.selected = true;
      }
    }
    thicknessSelect.addEventListener("change", async () => {
      this.settings.connectionWidth = parseInt(thicknessSelect.value);
      await this.saveSettings();
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });

    // ════════════════════════════════════════════════════════════
    // 3. BLOCK SETTINGS — Text Size + Width + Height agrupados
    // ════════════════════════════════════════════════════════════
    const blockBtn = this.createSidebarBtn(sidebar, "box", t("popover.blockSettings"), (btn) => {
      // clique gerenciado pelo addHoverFlyout
    });
    const blockFlyout = this.createFlyout(blockBtn, t("popover.blockSettings"));
    addHoverFlyout(blockBtn, blockFlyout);

    // — Sub: Alignment
    addLabel(blockFlyout, t("popover.alignment"), t("popover.alignmentTooltip"));
    let alignSelect: HTMLSelectElement;
    const alignContent = this.createFlyoutRow(blockFlyout, t("popover.alignment"), "📐", async () => {
      this.settings.textAlign = "titleCenter";
      await this.saveSettings();
      alignSelect.value = "titleCenter";
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });
    alignSelect = alignContent.createEl("select", { cls: "markmymind-select" }) as HTMLSelectElement;
    const alignOptions = [
      { value: "titleCenter", text: t("alignment.titleCenter") },
      { value: "left", text: t("alignment.left") },
      { value: "center", text: t("alignment.center") },
      { value: "right", text: t("alignment.right") },
    ];
    for (const optInfo of alignOptions) {
      const opt = alignSelect.createEl("option", { value: optInfo.value, text: optInfo.text });
      if (optInfo.value === (this.settings.textAlign || "titleCenter")) opt.selected = true;
    }
    alignSelect.addEventListener("change", async () => {
      this.settings.textAlign = alignSelect.value as any;
      await this.saveSettings();
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });

    // — Divisor visual
    blockFlyout.createDiv({ cls: "markmymind-flyout-divider" });

    // — Sub: Text Size
    addLabel(blockFlyout, t("popover.size"), t("popover.sizeTooltip"));
    let fontSelect: HTMLSelectElement;
    const fontContent = this.createFlyoutRow(blockFlyout, t("popover.size"), "🔤", async () => {
      this.settings.fontSize = DEFAULT_SETTINGS.fontSize;
      await this.saveSettings();
      fontSelect.value = String(DEFAULT_SETTINGS.fontSize);
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });
    fontSelect = fontContent.createEl("select", { cls: "markmymind-select" });
    for (let sz = 10; sz <= 24; sz += 2) {
      const opt = fontSelect.createEl("option", { value: String(sz), text: `${sz}px` });
      if (sz === (this.settings.fontSize || 12)) opt.selected = true;
    }
    fontSelect.addEventListener("change", async () => {
      this.settings.fontSize = parseInt(fontSelect.value);
      await this.saveSettings();
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });

    // — Divisor visual
    blockFlyout.createDiv({ cls: "markmymind-flyout-divider" });

    // — Sub: Width
    addLabel(blockFlyout, t("popover.width"), t("popover.widthTooltip"));
    let widthSelect: HTMLSelectElement;
    const widthContent = this.createFlyoutRow(blockFlyout, t("popover.width"), "↔️", async () => {
      this.settings.nodeWidth = DEFAULT_SETTINGS.nodeWidth;
      await this.saveSettings();
      widthSelect.value = String(DEFAULT_SETTINGS.nodeWidth);
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });
    widthSelect = widthContent.createEl("select", { cls: "markmymind-select" });
    const widthOptions = [
      { value: "0", text: t("width.auto") },
      { value: "200", text: "200px" },
      { value: "250", text: "250px" },
      { value: "300", text: "300px" },
      { value: "350", text: "350px" },
      { value: "400", text: "400px" },
      { value: "450", text: "450px" },
      { value: "500", text: "500px" },
      { value: "550", text: "550px" },
      { value: "600", text: "600px" },
      { value: "700", text: "700px" },
      { value: "800", text: "800px" },
    ];
    for (const optInfo of widthOptions) {
      const opt = widthSelect.createEl("option", { value: optInfo.value, text: optInfo.text });
      if (parseInt(optInfo.value) === (this.settings.nodeWidth || 0)) opt.selected = true;
    }
    widthSelect.addEventListener("change", async () => {
      this.settings.nodeWidth = parseInt(widthSelect.value);
      await this.saveSettings();
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });

    // — Divisor visual
    blockFlyout.createDiv({ cls: "markmymind-flyout-divider" });

    // — Sub: Height
    addLabel(blockFlyout, t("popover.maxHeight"), t("popover.maxHeightTooltip"));
    let limitSelect: HTMLSelectElement;
    const limitContent = this.createFlyoutRow(blockFlyout, t("popover.maxHeight"), "📏", async () => {
      this.settings.maxNodeHeight = DEFAULT_SETTINGS.maxNodeHeight;
      await this.saveSettings();
      limitSelect.value = String(DEFAULT_SETTINGS.maxNodeHeight);
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });
    limitSelect = limitContent.createEl("select", { cls: "markmymind-select" }) as HTMLSelectElement;
    const limitOptions = [
      { value: "0", text: t("height.noLimit") },
      { value: "100", text: "100px" },
      { value: "150", text: "150px" },
      { value: "200", text: "200px" },
      { value: "250", text: "250px" },
      { value: "300", text: "300px" },
      { value: "350", text: "350px" },
      { value: "400", text: "400px" },
      { value: "500", text: "500px" },
      { value: "600", text: "600px" },
      { value: "700", text: "700px" },
      { value: "800", text: "800px" },
    ];
    for (const optInfo of limitOptions) {
      const opt = limitSelect.createEl("option", { value: optInfo.value, text: optInfo.text });
      if (parseInt(optInfo.value) === (this.settings.maxNodeHeight || 0)) opt.selected = true;
    }
    limitSelect.addEventListener("change", async () => {
      this.settings.maxNodeHeight = parseInt(limitSelect.value);
      await this.saveSettings();
      if (this.currentRoot) this.engine?.render(this.currentRoot, this.currentLayout);
    });

  }

  private initEngine(): void {
    this.engine = new MindMapEngine(
      this.canvasEl,
      this.settings,
      // Edição de nó e nota no mapa → atualiza MD
      (nodeId, newLabel, newNote) => this.onMapNodeEdit(nodeId, newLabel, newNote),
      // Colapsar nó
      (nodeId) => this.onMapNodeCollapse(nodeId),
      // Fix #4: adicionar filho em qualquer nó
      (parentId, childLabel, side) => this.onMapNodeAddChild(parentId, childLabel, side),
      // Remoção de nó
      (nodeId) => this.onMapNodeDelete(nodeId),
      // Mover nó (Drag and Drop)
      (draggedId, targetId, position, side) => this.onMapNodeMove(draggedId, targetId, position, side),
      this,
      () => this.file?.path ?? ""
    );
  }

  private onMapNodeMove(draggedId: string, targetId: string, position: "before" | "after" | "inside", side?: "left" | "right"): void {
    if (!this.currentRoot) return;
    this.saveToHistory();
    this.isSyncing = true;

    if (position === "inside") {
      const parentNode = findNodeById(this.currentRoot, targetId);
      const draggedNode = findNodeById(this.currentRoot, draggedId);
      if (parentNode && draggedNode) {
        // Clona recursivamente o nó e seus filhos com novos IDs
        const cloneSubtree = (node: MindNode, currentLevel: number): MindNode => {
          return {
            id: `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            label: node.label,
            level: currentLevel,
            collapsed: node.collapsed,
            noteText: node.noteText,
            color: getLevelColor(currentLevel),
            children: node.children ? node.children.map(c => cloneSubtree(c, currentLevel + 1)) : [],
            side: node.side
          };
        };

        const newLevel = parentNode.level < 0 ? 1 : parentNode.level + 1;
        const cloned = cloneSubtree(draggedNode, newLevel);
        if (this.currentLayout === "bidirectional" && parentNode.level < 0) {
          cloned.side = side || "right";
        }

        // Adiciona ao pai
        parentNode.children.push(cloned);
        parentNode.collapsed = false;

        // Deleta o original
        deleteNodeById(this.currentRoot, draggedId);

        // Recalcula níveis
        recalcLevels(this.currentRoot);

        const newMd = this.buildFullMarkdown();
        this.currentMdContent = newMd;
        this.autoSave(newMd).then(() => {
          setTimeout(() => {
            this.isSyncing = false;
          }, 100);
        });
        new Notice(t("notice.updated") || "Estrutura atualizada");
        this.engine?.render(this.currentRoot, this.currentLayout);
        return;
      } else {
        this.isSyncing = false;
        this.engine?.render(this.currentRoot, this.currentLayout);
        return;
      }
    }

    const success = moveNodeInTree(this.currentRoot, draggedId, targetId, position);
    if (success) {
      const newMd = this.buildFullMarkdown();
      this.currentMdContent = newMd;
      this.autoSave(newMd).then(() => {
        setTimeout(() => {
          this.isSyncing = false;
        }, 100);
      });
      new Notice(t("notice.updated") || "Estrutura atualizada");
    } else {
      this.isSyncing = false;
    }
    this.engine?.render(this.currentRoot, this.currentLayout);
  }

  // ─── Sincronização Markdown → Mapa ────────────────────────────────────────

  private syncMdToMap(content: string, centerAfter = false): void {
    if (this.isSyncing) return;
    try {
      this.currentRoot = parseMarkdown(content, this.settings.singleH1Root);

      // Define o label da raiz virtual promovida: YAML > nome do arquivo
      const isPromotedVirtualRoot = !this.currentRoot.isVirtualRoot &&
        this.currentRoot.children.some(c => c.level === 0);
      if (isPromotedVirtualRoot) {
        const yamlLabel = this.getYamlRootLabel(content);
        this.currentRoot.label = yamlLabel ?? (this.file?.basename ?? "Mapa Mental");
      }

      const frontmatterLayout = this.getLayoutFromFrontmatter(this.file);
      if (frontmatterLayout) {
        this.currentLayout = frontmatterLayout;
        const layoutBtns = this.sidebarEl.querySelectorAll(".markmymind-grid-options button") as NodeListOf<HTMLButtonElement>;
        layoutBtns.forEach((btn) => {
          if (btn.dataset.value) {
            btn.classList.toggle("active", btn.dataset.value === frontmatterLayout);
          }
        });
      }

      this.engine?.render(this.currentRoot, this.currentLayout);
      if (centerAfter) {
        setTimeout(() => this.engine?.fitView(), 80);
      }
      this.setStatus("✓ Sincronizado");
    } catch (e) {
      this.setStatus("⚠ Erro no parser");
      console.error("[Mark My Mind] Erro ao parsear markdown:", e);
    }
  }

  private collapseTreeByLevel(node: MindNode, targetDepth: number, currentDepth = 0): void {
    if (node.isVirtualRoot) {
      node.collapsed = false;
    } else {
      if (currentDepth >= targetDepth) {
        node.collapsed = true;
      } else {
        node.collapsed = false;
      }
    }
    for (const child of node.children) {
      this.collapseTreeByLevel(child, targetDepth, currentDepth + 1);
    }
  }

  private expandAllNodes(node: MindNode): void {
    node.collapsed = false;
    for (const child of node.children) {
      this.expandAllNodes(child);
    }
  }

  // ─── Sincronização Mapa → Markdown ────────────────────────────────────────

  private onMapNodeEdit(nodeId: string, newLabel: string, newNote?: string): void {
    if (!this.currentRoot) return;
    this.saveToHistory();
    this.isSyncing = true;
    const updated = updateNodeContent(this.currentRoot, nodeId, newLabel, newNote);
    if (updated) {
      const newMd = this.buildFullMarkdown();
      this.currentMdContent = newMd;
      this.setStatus("✓ Mapa → Markdown");
      this.autoSave(newMd).then(() => {
        setTimeout(() => {
          this.isSyncing = false;
        }, 100);
      });
    } else {
      this.isSyncing = false;
    }
    this.engine?.render(this.currentRoot, this.currentLayout);
  }

    private onMapNodeCollapse(nodeId: string): void {
      if (!this.currentRoot) return;
      const node = findNodeById(this.currentRoot, nodeId);
      if (node) {
        node.collapsed = !node.collapsed;
        this.engine?.render(this.currentRoot, this.currentLayout);
      }
    }

  /** Fix #4: adiciona um filho ao nó clicado e atualiza o markdown */
  private onMapNodeAddChild(parentId: string, childLabel: string, side?: "left" | "right"): void {
    if (!this.currentRoot) return;
    const parent = findNodeById(this.currentRoot, parentId);
    if (!parent) return;

    this.saveToHistory();

    // Determina o nível do filho (máx H6=level5; acima disso vira lista=level6+)
    const childLevel = parent.level < 0 ? 1 : parent.level + 1;

    const newNode: MindNode = {
      id: `node-${Date.now()}`,
      label: childLabel,
      level: childLevel,
      children: [],
      color: getLevelColor(childLevel),
      collapsed: false,
    };

    if (this.currentLayout === "bidirectional" && parent.level < 0) {
      newNode.side = side;
    }
    parent.children.push(newNode);
    parent.collapsed = false; // abre o nó se estava colapsado

    const newMd = this.buildFullMarkdown();
    
    this.isSyncing = true;
    this.currentMdContent = newMd;
    
    this.autoSave(newMd).then(() => {
      setTimeout(() => {
        this.isSyncing = false;
      }, 100);
    });
    
    this.engine?.render(this.currentRoot, this.currentLayout);
    this.setStatus(`✓ Bloco "${childLabel}" adicionado`);
  }

  private onMapNodeDelete(nodeId: string): void {
    if (!this.currentRoot) return;
    this.saveToHistory();
    this.isSyncing = true;

    let deleted = false;
    if (this.engine && this.engine.selectedNodeIds.size > 1) {
      for (const id of this.engine.selectedNodeIds) {
        if (deleteNodeById(this.currentRoot, id)) {
          deleted = true;
        }
      }
      this.engine.selectedNodeIds.clear();
      this.engine.selectedNodeId = null;
    } else {
      deleted = deleteNodeById(this.currentRoot, nodeId);
      if (this.engine) {
        this.engine.selectedNodeIds.delete(nodeId);
        if (this.engine.selectedNodeId === nodeId) {
          this.engine.selectedNodeId = null;
        }
      }
    }

    if (deleted) {
      const newMd = this.buildFullMarkdown();
      this.currentMdContent = newMd;
      this.setStatus("✓ Blocos removidos");
      this.autoSave(newMd).then(() => {
        setTimeout(() => {
          this.isSyncing = false;
        }, 100);
      });
    } else {
      this.isSyncing = false;
    }
    this.engine?.render(this.currentRoot, this.currentLayout);
  }

  // ─── Layout ───────────────────────────────────────────────────────────────

  private setLayout(layout: LayoutType): void {
    const normalized = normalizeLayout(layout);
    this.currentLayout = normalized;
    const layoutBtns = this.sidebarEl.querySelectorAll(".markmymind-grid-options button") as NodeListOf<HTMLButtonElement>;
    layoutBtns.forEach((btn) => {
      if (btn.dataset.value) {
        btn.classList.toggle("active", btn.dataset.value === normalized);
      }
    });

    const newMd = this.updateYamlFrontmatter(this.currentMdContent, normalized);
    if (newMd !== this.currentMdContent) {
      this.saveToHistory();
      this.isSyncing = true;
      this.currentMdContent = newMd;
      this.autoSave(newMd).then(() => {
        setTimeout(() => {
          this.isSyncing = false;
        }, 100);
      });
    }

    if (this.currentRoot) {
      this.engine?.render(this.currentRoot, normalized);
      setTimeout(() => this.engine?.fitView(), 50);
    }
  }

  private getLayoutFromFrontmatter(file: TFile | null): LayoutType | null {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    const mmmLayout = cache?.frontmatter?.["mmm-layout"];
    if (mmmLayout) {
      const cleanLayout = String(mmmLayout).trim().toLowerCase();
      if (cleanLayout === ">") return "right";
      if (cleanLayout === "<>") return "bidirectional";
      if (cleanLayout === "v") return "down";
      if (cleanLayout === "a") return "up";
    }
    return null;
  }

  private updateYamlFrontmatter(content: string, layout: LayoutType): string {
    const yamlRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(yamlRegex);
    
    const layoutSymbolMap: Record<string, string> = {
      right: ">",
      bidirectional: "<>",
      down: "V",
      up: "A"
    };
    const symbol = layoutSymbolMap[layout] || ">";

    if (match) {
      let yamlContent = match[1];
      
      if (yamlContent.includes("mmm-layout:")) {
        yamlContent = yamlContent.replace(/mmm-layout:\s*["']?[^"'\n\r]+["']?/g, `mmm-layout: "${symbol}"`);
      } else {
        yamlContent = yamlContent.trim() + `\nmmm-layout: "${symbol}"`;
      }
      
      if (yamlContent.includes("markmind-type:")) {
        yamlContent = yamlContent.replace(/markmind-type:\s*["']?mindmap["']?/g, `mmm-type: mindmap`);
      } else if (!yamlContent.includes("mmm-type:")) {
        yamlContent = yamlContent.trim() + `\nmmm-type: mindmap`;
      }
      
      return `---\n${yamlContent.trim()}\n---\n${content.replace(yamlRegex, "")}`;
    } else {
      return `---\nmmm-type: mindmap\nmmm-layout: "${symbol}"\n---\n\n${content}`;
    }
  }

  private showColorPalettePopover(
    targetEl: HTMLElement,
    settingKey: "colorH1" | "colorH2" | "colorH3" | "colorH4" | "colorH5" | "colorH6" | "colorH7" | "colorH8",
    defaultVal: string,
    onColorChange: (newColor: string) => void
  ): void {
    // Remove qualquer outro popover aberto
    const existing = document.querySelector(".markmymind-palette-popover");
    if (existing) existing.remove();

    const popover = document.createElement("div");
    popover.className = "markmymind-palette-popover";
    popover.style.cssText = `
      position: absolute;
      background: var(--background-secondary-alt, #191924);
      border: 1px solid var(--background-modifier-border, #2d2d3d);
      border-radius: 10px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.4);
      padding: 10px;
      display: grid;
      grid-template-columns: repeat(4, 24px);
      gap: 8px;
      z-index: 9999;
    `;

    const colors = [
      "#ef4444", // Vermelho
      "#f97316", // Laranja
      "#eab308", // Amarelo
      "#22c55e", // Verde
      "#06b6d4", // Ciano
      "#3b82f6", // Azul
      "#8b5cf6", // Roxo
      "#ec4899", // Rosa/Magenta
      "#1e1e2e", // Grafite escuro
      "#7f8c8d", // Cinza
      "#ffffff"  // Branco
    ];

    const currentVal = this.settings[settingKey] || defaultVal;

    colors.forEach((color) => {
      const colorBox = popover.createDiv();
      const isSelected = currentVal.toLowerCase() === color.toLowerCase();
      const borderColor = isSelected ? "var(--text-accent, #6366f1)" : "rgba(0,0,0,0.15)";
      
      colorBox.style.cssText = `
        width: 24px;
        height: 24px;
        background-color: ${color};
        border-radius: 6px;
        cursor: pointer;
        border: 2px solid ${borderColor};
        box-shadow: ${isSelected ? "0 0 0 2px var(--background-primary)" : "none"};
        box-sizing: border-box;
        transition: transform 0.1s ease;
      `;
      colorBox.addEventListener("click", () => {
        onColorChange(color);
        popover.remove();
      });
      colorBox.addEventListener("mouseenter", () => colorBox.style.transform = "scale(1.1)");
      colorBox.addEventListener("mouseleave", () => colorBox.style.transform = "scale(1)");
    });

    // Bloco especial gradiente para cor personalizada
    const customBox = popover.createDiv();
    const isCustom = !colors.some(c => c.toLowerCase() === currentVal.toLowerCase());
    const customBorderColor = isCustom ? "var(--text-accent, #6366f1)" : "rgba(0,0,0,0.15)";
    
    customBox.style.cssText = `
      width: 24px;
      height: 24px;
      background: linear-gradient(135deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899);
      border-radius: 6px;
      cursor: pointer;
      border: 2px solid ${customBorderColor};
      box-shadow: ${isCustom ? "0 0 0 2px var(--background-primary)" : "none"};
      box-sizing: border-box;
      transition: transform 0.1s ease;
      position: relative;
      overflow: hidden;
    `;
    
    const hiddenInput = document.createElement("input");
    hiddenInput.type = "color";
    hiddenInput.value = currentVal;
    // Ocultação transparente por cima do botão: abre nativamente na posição correta e contorna bloqueios de segurança do Chromium
    hiddenInput.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; margin: 0; box-sizing: border-box;";
    customBox.appendChild(hiddenInput);

    hiddenInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    hiddenInput.addEventListener("input", () => {
      onColorChange(hiddenInput.value);
    });

    hiddenInput.addEventListener("change", () => {
      popover.remove();
    });

    customBox.addEventListener("mouseenter", () => customBox.style.transform = "scale(1.1)");
    customBox.addEventListener("mouseleave", () => customBox.style.transform = "scale(1)");

    const parentContainer = targetEl.closest(".markmymind-color-pickers-container") as HTMLElement;
    if (parentContainer) {
      parentContainer.appendChild(popover);
      const containerHeight = parentContainer.offsetHeight || 60;
      const popoverHeight = 108; // altura aproximada de 3 linhas
      const top = (containerHeight - popoverHeight) / 2;
      popover.style.left = "50%";
      popover.style.top = `${top}px`;
      popover.style.transform = "translateX(-50%)";
      popover.style.animation = "mm-popover-fade-in-centered 0.12s ease-out forwards";
    } else {
      document.body.appendChild(popover);
      // Posicionamento inteligente (evita sair da tela, ótimo para mobile)
      const rect = targetEl.getBoundingClientRect();
      let left = rect.left + window.scrollX - 48; // centraliza levemente
      let top = rect.top + window.scrollY - 116; // posiciona acima (altura da popover de 3 linhas é aprox 106px)

      if (left < 10) left = 10;
      if (left + 140 > window.innerWidth) left = window.innerWidth - 150;
      if (top < 10) top = rect.bottom + window.scrollY + 8; // se não couber em cima, põe embaixo

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.transform = "none";
      popover.style.animation = "mm-popover-fade-in 0.12s ease-out forwards";
    }

    const outsideClickListener = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && !targetEl.contains(e.target as Node)) {
        popover.remove();
        hiddenInput.remove();
        document.removeEventListener("mousedown", outsideClickListener);
      }
    };
    document.addEventListener("mousedown", outsideClickListener);
  }

  // ─── Persistência ─────────────────────────────────────────────────────────



  private getYamlHeader(content: string): string {
    const yamlRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(yamlRegex);
    return match ? match[0] : "";
  }

  private getYamlRootLabel(content: string): string | null {
    const yamlRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(yamlRegex);
    if (match) {
      const rootMatch = match[1].match(/^mmm-notename:\s*(.+)$/m);
      if (rootMatch) return rootMatch[1].trim();
    }
    return null;
  }

  private ensureRootLabelInYaml(yamlHeader: string, label: string): string {
    if (!yamlHeader) {
      return `---\nmmm-notename: ${label}\n---\n`;
    }
    if (/^mmm-notename:\s*.*$/m.test(yamlHeader)) {
      return yamlHeader.replace(/^mmm-notename:\s*.*$/m, `mmm-notename: ${label}`);
    }
    return yamlHeader.replace(/^---\n/, `---\nmmm-notename: ${label}\n`);
  }

  private buildFullMarkdown(): string {
    const body = mindMapToMarkdown(this.currentRoot!, this.currentLayout);
    const isPromotedVirtualRoot = !this.currentRoot!.isVirtualRoot &&
      this.currentRoot!.children.some(c => c.level === 0);

    if (isPromotedVirtualRoot) {
      const yamlHeader = this.getYamlHeader(this.currentMdContent);
      return this.ensureRootLabelInYaml(yamlHeader, this.currentRoot!.label) + body;
    }

    return this.getYamlHeader(this.currentMdContent) + body;
  }

  private autoSave(content: string): Promise<void> {
    if (!this.file) return Promise.resolve();
    return this.app.vault.modify(this.file, content);
  }

  // ─── Undo / Redo (Desfazer / Refazer) ──────────────────────────────────────

  private getHistory() {
    if (!this.file || !this.plugin) return { undoStack: [] as string[], redoStack: [] as string[] };
    if (!this.plugin.historyMap) {
      this.plugin.historyMap = new Map();
    }
    let hist = this.plugin.historyMap.get(this.file.path);
    if (!hist) {
      hist = { undoStack: [], redoStack: [] };
      this.plugin.historyMap.set(this.file.path, hist);
    }
    return hist;
  }

  private saveToHistory(): void {
    const hist = this.getHistory();
    if (hist.undoStack.length > 0 && hist.undoStack[hist.undoStack.length - 1] === this.currentMdContent) {
      return;
    }
    hist.undoStack.push(this.currentMdContent);
    if (hist.undoStack.length > this.maxHistorySize) {
      hist.undoStack.shift();
    }
    hist.redoStack = [];
  }

  undo(): void {
    const hist = this.getHistory();
    if (hist.undoStack.length === 0) {
      new Notice(t("notice.nothingToUndo"));
      return;
    }
    const previousContent = hist.undoStack.pop()!;
    hist.redoStack.push(this.currentMdContent);

    this.isSyncing = true;
    this.currentMdContent = previousContent;
    this.autoSave(previousContent).then(() => {
      setTimeout(() => {
        this.isSyncing = false;
      }, 100);
    });
    try {
      this.currentRoot = parseMarkdown(previousContent, this.settings.singleH1Root);
      this.engine?.render(this.currentRoot, this.currentLayout);
    } catch (e) {
      console.error("[Mark My Mind] Erro ao aplicar desfazer:", e);
    }
    new Notice(t("notice.undone"));
  }

  redo(): void {
    const hist = this.getHistory();
    if (hist.redoStack.length === 0) {
      new Notice(t("notice.nothingToRedo"));
      return;
    }
    const nextContent = hist.redoStack.pop()!;
    hist.undoStack.push(this.currentMdContent);

    this.isSyncing = true;
    this.currentMdContent = nextContent;
    this.autoSave(nextContent).then(() => {
      setTimeout(() => {
        this.isSyncing = false;
      }, 100);
    });
    try {
      this.currentRoot = parseMarkdown(nextContent, this.settings.singleH1Root);
      this.engine?.render(this.currentRoot, this.currentLayout);
    } catch (e) {
      console.error("[Mark My Mind] Erro ao aplicar refazer:", e);
    }
    new Notice(t("notice.redone"));
  }

  private registerUndoRedoKeys(): void {
    this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(MarkMyMindView) !== this) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        return;
      }

      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey;
      const isRedo = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey));
      const isDelete = e.key === "Delete" || e.key === "Backspace";
      const isAddChild = e.key === "+" || e.key === "=";
      const isCollapse = e.key === "-" || e.key === "_";
      const isArrow = e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight";
      const isLevelKey = /^[1-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isSelectAll = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a";
      const isResetKey = e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isFitKey = e.key.toLowerCase() === "a" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isFocusSelectedKey = e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isTitlesOnlyKey = e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isSingleH1RootKey = e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isBackToEditorKey = e.key.toLowerCase() === "e" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isSplitViewKey = (e.ctrlKey || e.metaKey) && e.key === "\\";

      if (isUndo) {
        e.preventDefault();
        this.undo();
      } else if (isRedo) {
        e.preventDefault();
        this.redo();
      } else if (isSelectAll) {
        e.preventDefault();
        this.engine?.selectAllNodes();
      } else if (isResetKey) {
        e.preventDefault();
        this.engine?.centerView();
      } else if (isFitKey) {
        e.preventDefault();
        this.engine?.fitView();
      } else if (isFocusSelectedKey) {
        e.preventDefault();
        this.engine?.focusOnSelected();
      } else if (isTitlesOnlyKey) {
        e.preventDefault();
        this.cycleTitlesState();
      } else if (isSingleH1RootKey) {
        e.preventDefault();
        this.settings.singleH1Root = !this.settings.singleH1Root;
        this.singleH1RootBtn?.classList.toggle("active", this.settings.singleH1Root);
        this.saveSettings();
        this.syncMdToMap(this.currentMdContent, false);
        this.engine?.fitView();
      } else if (isLevelKey) {
        e.preventDefault();
        const levelNum = parseInt(e.key);
        if (this.currentRoot) {
          this.levelBtns.forEach(b => {
            b.classList.toggle("active", b.dataset.level === e.key);
          });
          this.collapseTreeByLevel(this.currentRoot, levelNum);
          this.engine?.render(this.currentRoot, this.currentLayout);
        }
      } else if (isDelete) {
        if (this.engine?.selectedNodeId) {
          e.preventDefault();
          this.onMapNodeDelete(this.engine.selectedNodeId);
        }
      } else if (isAddChild) {
        if (this.engine?.selectedNodeId) {
          e.preventDefault();
          this.engine.addChildToSelected();
        }
      } else if (isCollapse) {
        if (this.engine?.selectedNodeId) {
          e.preventDefault();
          this.onMapNodeCollapse(this.engine.selectedNodeId);
        }
      } else if (isArrow) {
        e.preventDefault();
        let direction: "up" | "down" | "left" | "right";
        switch (e.key) {
          case "ArrowUp":
            direction = "up";
            break;
          case "ArrowDown":
            direction = "down";
            break;
          case "ArrowLeft":
            direction = "left";
            break;
          case "ArrowRight":
            direction = "right";
            break;
        }
        if (e.shiftKey) {
          if (direction === "right") this.setLayout("right");
          else if (direction === "down") this.setLayout("down");
          else if (direction === "up") this.setLayout("up");
          else if (direction === "left") this.setLayout("bidirectional");
        } else {
          this.engine?.navigateWithKeyboard(direction, false);
        }
      } else if (isBackToEditorKey) {
        e.preventDefault();
        if (this.file) {
          if (this.plugin) {
            this.plugin.markdownModeFiles.add(this.file.path);
          }
          this.leaf.setViewState({
            type: "markdown",
            state: { file: this.file.path },
            active: true,
          });
        }
      } else if (isSplitViewKey) {
        e.preventDefault();
        if (this.file && this.plugin) {
          this.plugin.toggleSplitView(this.file, this.leaf);
        }
      }
    });
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  private setStatus(text: string): void {
    // Status desativado conforme solicitado
  }

  // ─── Estado da View (persistência entre sessões) ───────────────────────────

  getState(): Record<string, any> {
    return { file: this.file?.path ?? null, layout: this.currentLayout };
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    if (state.layout) this.currentLayout = state.layout as LayoutType;
    if (state.file && typeof state.file === "string") {
      const file = this.app.vault.getAbstractFileByPath(state.file);
      if (file instanceof TFile) await this.loadFile(file);
    }
    this.updateTitlesBtnVisual();
  }

  private async cycleTitlesState(): Promise<void> {
    if (this.settings.showNoteText === true) {
      this.settings.showNoteText = false;
      this.settings.autoExpandSelected = true;
    } else if (this.settings.autoExpandSelected === true) {
      this.settings.showNoteText = false;
      this.settings.autoExpandSelected = false;
    } else {
      this.settings.showNoteText = true;
      this.settings.autoExpandSelected = false;
    }

    await this.saveSettings();
    this.updateTitlesBtnVisual();

    if (this.currentRoot) {
      this.engine?.render(this.currentRoot, this.currentLayout);
      this.engine?.fitView();
    }
  }

  private updateTitlesBtnVisual(): void {
    if (!this.titlesBtn) return;
    
    this.titlesBtn.removeClass("active");
    this.titlesBtn.removeClass("active-selected-only");
    this.titlesBtn.removeClass("active-titles-only");

    if (this.settings.showNoteText === true) {
      setTooltip(this.titlesBtn, t("toolbar.titlesOnlyTooltipAll"));
    } else if (this.settings.autoExpandSelected === true) {
      this.titlesBtn.addClass("active-selected-only");
      setTooltip(this.titlesBtn, t("toolbar.titlesOnlyTooltipSelected"));
    } else {
      this.titlesBtn.addClass("active-titles-only");
      setTooltip(this.titlesBtn, t("toolbar.titlesOnlyTooltipNone"));
    }
  }
}

class DonationModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("markmymind-donation-modal");

    contentEl.createEl("h2", { text: t("donate.title"), cls: "donation-modal-title" });
    
    const bodyText = contentEl.createDiv({ cls: "donation-modal-body" });
    
    bodyText.createEl("p", {
      text: t("donate.intro"),
      cls: "donation-intro"
    });
    
    bodyText.createEl("p", {
      text: t("donate.body"),
      cls: "donation-body-text"
    });

    const actionContainer = contentEl.createDiv({ cls: "donation-pix-container" });
    actionContainer.createDiv({ text: t("donate.pixHeader"), cls: "donation-pix-header" });
    
    const donateBtn = actionContainer.createEl("button", {
      cls: "markmymind-btn copy-pix-btn",
      text: t("donate.btn")
    });
    donateBtn.addEventListener("click", () => {
      window.open("https://ko-fi.com/phmdev", "_blank");
      new Notice(t("donate.redirect"));
    });

    const footer = contentEl.createDiv({ cls: "donation-modal-footer" });
    footer.createEl("span", { text: t("donate.footer") });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
