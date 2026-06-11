/**
 * main.ts — Mark My Mind Plugin
 * Plugin Obsidian que integra editor Markdown com Mapa Mental interativo.
 * Nós visuais em bloco, conversão bidirecional, canvas com zoom/pan.
 */

import { Plugin, TFile, TFolder, WorkspaceLeaf, Notice, MarkdownView } from "obsidian";
import { MarkMyMindView, MARKMYMIND_VIEW_TYPE } from "./src/MarkMyMindView";
import { MarkMyMindSettings, DEFAULT_SETTINGS, MarkMyMindSettingTab } from "./src/settings";
import { initI18n, t } from "./src/i18n";

export default class MarkMyMindPlugin extends Plugin {
  settings!: MarkMyMindSettings;
  markdownModeFiles: Set<string> = new Set();
  lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
  lastActiveLeafWasMindmap = false;
  originalOpenFile: any;
  historyMap: Map<string, { undoStack: string[], redoStack: string[] }> = new Map();
  splitLeaves: Map<string, WorkspaceLeaf> = new Map();

  async onload(): Promise<void> {
    console.log("[Mark My Mind] Carregando plugin...");

    // Inicializa o sistema de traduções (i18next)
    await initI18n();

    // Carrega configurações
    await this.loadSettings();

    // Registra a View principal (DEVE ser síncrono no onload)
    this.registerView(
      MARKMYMIND_VIEW_TYPE,
      (leaf) => new MarkMyMindView(leaf, this.settings, () => this.saveSettings(), this)
    );

    // Rastreador de abas ativas para reuso inteligente e botão de alternância
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) return;
        if (leaf.view instanceof MarkdownView) {
          this.lastActiveMarkdownLeaf = leaf;
          this.lastActiveLeafWasMindmap = false;
          this.addToggleModeButton(leaf);
        } else if (leaf.view.getViewType() === MARKMYMIND_VIEW_TYPE) {
          this.lastActiveLeafWasMindmap = true;
        } else {
          this.lastActiveLeafWasMindmap = false;
        }
      })
    );

    // ── Comando: Abrir arquivo atual como Mark My Mind ──
    this.addCommand({
      id: "open-as-markmymind",
      name: t("commands.openAs"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            this.openMarkMyMindView(file);
          }
          return true;
        }
        return false;
      },
    });

    // ── Comando: Criar novo mapa mental (.md do zero) ──
    this.addCommand({
      id: "create-new-mindmap",
      name: t("commands.createNew"),
      callback: () => {
        this.createNewMindmapFile();
      },
    });

    // ── Comando global: Criar ou abrir mapa mental ──
    this.addCommand({
      id: "create-or-open-map",
      name: t("commands.createOrOpenMap"),
      hotkeys: [{ modifiers: ["Mod"], key: "m" }],
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          this.openMarkMyMindView(file);
        } else {
          this.createNewMindmapFile();
        }
      },
    });

    // ── Ribbon (ícone na barra lateral esquerda) ──
    this.addRibbonIcon("brain-circuit", t("ribbon.tooltip"), () => {
      const file = this.app.workspace.getActiveFile();
      if (file && file.extension === "md") {
        this.openMarkMyMindView(file);
      } else {
        this.createNewMindmapFile();
      }
    });

    // ── Menu de contexto na Sidebar (arquivos e pastas) ──
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        // Se for um arquivo markdown, mostra a opção de abrir como Mark My Mind
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle(t("menu.openAs"))
              .setIcon("brain-circuit")
              .onClick(() => this.openMarkMyMindView(file));
          });
        }

        // Adiciona a opção de criar um novo mapa mental na pasta correspondente
        menu.addItem((item) => {
          item
            .setTitle(t("menu.createNew"))
            .setIcon("brain-circuit")
            .onClick(async () => {
              let folderPath = "";
              if (file instanceof TFile) {
                folderPath = file.parent ? file.parent.path : "";
              } else if (file instanceof TFolder) {
                folderPath = file.path;
              }

              const initialContent = this.addMindmapFrontmatter("# Novo Mapa Mental\n\n- Novo Nó Principal\n");
              const newFile = await this.createUniqueFile("Sem Título - Mapa Mental", folderPath, initialContent);
              new Notice(`${t("notice.created")}: ${newFile.name}`);
              await this.openMarkMyMindView(newFile);
            });
        });
      })
    );

    // ── Interceptador nativo de openFile na WorkspaceLeaf para evitar qualquer lag ou aba duplicada ──
    const originalOpenFile = WorkspaceLeaf.prototype.openFile;
    const pluginInstance = this;

    WorkspaceLeaf.prototype.openFile = async function (file: TFile, state?: any) {
      if (file && file.extension === "md") {
        try {
          const cache = pluginInstance.app.metadataCache.getFileCache(file);
          const isMindmap = cache?.frontmatter?.["mmm-type"] === "mindmap" || pluginInstance.settings.autoOpenForMd;

          if (isMindmap) {
            // 1. Verifica se já está aberto em uma view MarkMyMindView
            const existingLeaves = pluginInstance.app.workspace.getLeavesOfType(MARKMYMIND_VIEW_TYPE);
            const alreadyOpenLeaf = existingLeaves.find(
              (l) => l.view instanceof MarkMyMindView && l.view.file?.path === file.path
            );

            if (alreadyOpenLeaf && alreadyOpenLeaf !== this) {
              // Foca imediatamente na aba existente
              pluginInstance.app.workspace.revealLeaf(alreadyOpenLeaf);

              // Se a folha que tentou abrir for uma nova aba vazia, fecha ela
              if (this.view.getViewType() === "empty") {
                this.detach();
              }
              return; // Bloqueia a abertura duplicada sem lag
            }

            // 2. Se não estiver aberto em nenhuma aba de mapa, abre como Mapa Mental
            if (!pluginInstance.markdownModeFiles.has(file.path)) {
              setTimeout(async () => {
                await this.setViewState({
                  type: MARKMYMIND_VIEW_TYPE,
                  active: true,
                  state: { file: file.path }
                });
              }, 50);
              return; // Converte diretamente sem instanciar MarkdownView
            }
          } else {
            // É uma nota normal!
            // Se a aba ativa anterior era um Mapa Mental, vamos redirecionar para a última aba markdown ativa
            const wasMindmapActive = pluginInstance.lastActiveLeafWasMindmap;
            if (wasMindmapActive && pluginInstance.lastActiveMarkdownLeaf) {
              const allLeaves: WorkspaceLeaf[] = [];
              pluginInstance.app.workspace.iterateAllLeaves((l) => { allLeaves.push(l); });
              const leafExists = allLeaves.includes(pluginInstance.lastActiveMarkdownLeaf);

              if (leafExists && this !== pluginInstance.lastActiveMarkdownLeaf) {
                await pluginInstance.lastActiveMarkdownLeaf.openFile(file, state);
                pluginInstance.app.workspace.revealLeaf(pluginInstance.lastActiveMarkdownLeaf);
                
                // Se a folha que tentou abrir for uma nova aba vazia, fecha ela
                if (this.view.getViewType() === "empty") {
                  this.detach();
                }
                return;
              }
            }
          }
        } catch (e) {
          console.error("[Mark My Mind] Erro ao interceptar openFile:", e);
        }
      }

      // Executa o comportamento padrão do Obsidian
      return originalOpenFile.call(this, file, state);
    };

    this.originalOpenFile = originalOpenFile;

    // ── Aba de configurações ──
    this.addSettingTab(new MarkMyMindSettingTab(this.app, this));

    console.log("[Mark My Mind] Plugin carregado com sucesso!");
  }

  onunload(): void {
    if (this.originalOpenFile) {
      WorkspaceLeaf.prototype.openFile = this.originalOpenFile;
    }
    console.log("[Mark My Mind] Plugin descarregado.");
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ─── Abertura da View ─────────────────────────────────────────────────────

  /** Rastreia e adiciona o botão de alternância no editor de texto */
  addToggleModeButton(leaf: WorkspaceLeaf) {
    const view = leaf.view as any;
    const file = view.file;
    if (!file) return;

    this.app.vault.cachedRead(file).then((content) => {
      const isMindmap = /mmm-type:\s*['"]?mindmap['"]?/.test(content) || this.settings.autoOpenForMd;
      
      if (isMindmap) {
        if (!view.markmymindButtonEl) {
          view.markmymindButtonEl = view.addAction("brain-circuit", t("menu.openAs"), async () => {
            const currentFile = view.file;
            if (currentFile) {
              this.markdownModeFiles.delete(currentFile.path);
              await leaf.setViewState({
                type: MARKMYMIND_VIEW_TYPE,
                active: true,
                state: { file: currentFile.path }
              });
            }
          });
        }
        if (view.markmymindButtonEl) {
          view.markmymindButtonEl.style.display = ""; // Exibe o botão
        }
      } else {
        if (view.markmymindButtonEl) {
          view.markmymindButtonEl.style.display = "none"; // Oculta o botão
        }
      }
    });
  }

  /** Abre o Mark My Mind com um arquivo específico */
  async openMarkMyMindView(file: TFile): Promise<void> {
    const { workspace } = this.app;

    // Garante que a nota abra em modo Mapa Mental
    this.markdownModeFiles.delete(file.path);

    // Verifica se já existe uma view aberta para este arquivo específico
    const existingLeaves = workspace.getLeavesOfType(MARKMYMIND_VIEW_TYPE);
    const fileLeaf = existingLeaves.find(
      (l) => l.view instanceof MarkMyMindView && l.view.file?.path === file.path
    );

    if (fileLeaf) {
      // Se já estiver aberto, apenas foca na aba existente
      workspace.revealLeaf(fileLeaf);
      return;
    }

    // Se não estiver aberto, abre em uma nova aba
    const leaf = workspace.getLeaf("tab");

    await leaf.setViewState({
      type: MARKMYMIND_VIEW_TYPE,
      active: true,
      state: { file: file.path }
    });

    workspace.revealLeaf(leaf);
  }

  /** Cria um novo arquivo Markdown em branco para Mapa Mental e o abre */
  async createNewMindmapFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const parentPath = activeFile && activeFile.parent ? activeFile.parent.path : "";
    const initialContent = this.addMindmapFrontmatter("# Novo Mapa Mental\n\n- Novo Nó Principal\n");
    const file = await this.createUniqueFile("Sem Título - Mapa Mental", parentPath, initialContent);
    new Notice(`${t("notice.created")}: ${file.name}`);
    await this.openMarkMyMindView(file);
  }

  addMindmapFrontmatter(content: string): string {
    const yamlRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(yamlRegex);
    if (match) {
      const yamlContent = match[1];
      if (yamlContent.includes("mmm-type:")) {
        return content;
      }
      return `---\n${yamlContent.trim()}\nmmm-type: mindmap\n---\n${content.replace(yamlRegex, "")}`;
    }
    return `---\nmmm-type: mindmap\n---\n\n${content}`;
  }

  // ─── Split View (Editor + MindMap lado a lado) ──────────────────────────

  isSplitActive(filePath: string): boolean {
    const leaf = this.splitLeaves.get(filePath);
    if (!leaf) return false;
    if (!leaf.view) {
      this.splitLeaves.delete(filePath);
      return false;
    }
    return true;
  }

  async toggleSplitView(file: TFile, currentLeaf: WorkspaceLeaf): Promise<void> {
    const existingSplit = this.splitLeaves.get(file.path);

    if (existingSplit) {
      existingSplit.detach();
      this.splitLeaves.delete(file.path);
      await currentLeaf.setViewState({
        type: MARKMYMIND_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      });
      return;
    }

    await currentLeaf.setViewState({
      type: "markdown",
      state: { file: file.path },
      active: false,
    });

    const mindmapLeaf = this.app.workspace.getLeaf("split", "vertical");
    if (mindmapLeaf) {
      this.splitLeaves.set(file.path, mindmapLeaf);
      await mindmapLeaf.setViewState({
        type: MARKMYMIND_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      });
    }
  }

  cleanupSplitLeaf(filePath: string, leaf: WorkspaceLeaf): void {
    const splitLeaf = this.splitLeaves.get(filePath);
    if (splitLeaf === leaf) {
      this.splitLeaves.delete(filePath);
    }
  }

  /** Auxiliar: Cria um arquivo com nome único para evitar sobreposição */
  private async createUniqueFile(baseName: string, parentPath: string, content: string): Promise<TFile> {
    let folderPath = parentPath || "";
    // Limpa barras duplicadas, iniciais ou finais para evitar caminhos como "//Nome.md"
    folderPath = folderPath.trim().replace(/^\/+|\/+$/g, "");

    let filePath = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
    let counter = 0;
    while (this.app.vault.getAbstractFileByPath(filePath)) {
      counter++;
      filePath = folderPath 
        ? `${folderPath}/${baseName} ${counter}.md` 
        : `${baseName} ${counter}.md`;
    }
    return await this.app.vault.create(filePath, content);
  }
}
