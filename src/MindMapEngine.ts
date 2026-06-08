/**
 * MindMapEngine.ts
 * Motor de renderização SVG do mapa mental.
 * - Texto multi-linha sem truncamento
 * - Botões collapse/add na direção do layout (horizontal=direita, vertical=baixo)
 */

import * as d3 from "d3";
import { MarkdownRenderer, Component, Notice } from "obsidian";
import { MindNode, getLevelColor, assignColors, findNodeById } from "./MarkdownParser";
import {
  calculateLayout, LayoutType, NodePosition,
  computeNodeHeight, computeNodeWidth, wrapText,
  normalizeLayout
} from "./LayoutEngine";
import { MarkMyMindSettings } from "./settings";

export type NodeEditCallback = (nodeId: string, newLabel: string, newNote?: string) => void;
export type NodeCollapseCallback = (nodeId: string) => void;
export type NodeAddChildCallback = (parentId: string, childLabel: string, side?: "left" | "right") => void;
export type NodeDeleteCallback = (nodeId: string) => void;
export type NodeMoveCallback = (draggedId: string, targetId: string, position: "before" | "after" | "inside", side?: "left" | "right") => void;

export class MindMapEngine {
  private container: HTMLElement;
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private rootGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private currentRoot: MindNode | null = null;
  private currentLayout: LayoutType = "right";
  private settings: MarkMyMindSettings;
  private onNodeEdit: NodeEditCallback;
  private onNodeCollapse: NodeCollapseCallback;
  private onNodeAddChild: NodeAddChildCallback;
  private onNodeDelete: NodeDeleteCallback;
  private onNodeMove: NodeMoveCallback;
  private component: Component;
  private getFilePath: () => string;
  private initialized = false;
  public selectedNodeId: string | null = null;
  public selectedNodeIds: Set<string> = new Set();
  public isEditing = false;
  private layoutLockCleanup: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    settings: MarkMyMindSettings,
    onNodeEdit: NodeEditCallback,
    onNodeCollapse: NodeCollapseCallback,
    onNodeAddChild: NodeAddChildCallback,
    onNodeDelete: NodeDeleteCallback,
    onNodeMove: NodeMoveCallback,
    component: Component,
    getFilePath: () => string
  ) {
    this.container = container;
    this.settings = settings;
    this.onNodeEdit = onNodeEdit;
    this.onNodeCollapse = onNodeCollapse;
    this.onNodeAddChild = onNodeAddChild;
    this.onNodeDelete = onNodeDelete;
    this.onNodeMove = onNodeMove;

    this.component = component;
    this.getFilePath = getFilePath;

    requestAnimationFrame(() => {
      this.initSVG();
      this.initialized = true;
      if (this.currentRoot) {
        this.render(this.currentRoot, this.currentLayout);
        this.centerView();
      }
    });
  }

  private initSVG(): void {
    this.container.innerHTML = "";

    this.svg = d3.select(this.container)
      .append("svg")
      .attr("width", "100%").attr("height", "100%")
      .attr("class", "markmymind-svg");

    const defs = this.svg.append("defs");
    defs.append("linearGradient")
      .attr("id", "mm-root-grad")
      .attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "100%")
      .selectAll("stop")
      .data([
        { offset: "0%", color: "#6366f1" },
        { offset: "100%", color: "#8b5cf6" },
      ])
      .join("stop")
      .attr("offset", d => d.offset)
      .attr("stop-color", d => d.color);

    this.rootGroup = this.svg.append("g").attr("class", "markmymind-root");

    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 3])
      .on("zoom", (e) => this.rootGroup.attr("transform", e.transform.toString()));

    this.svg.call(this.zoom);
    this.svg.on("dblclick.zoom", null);
    this.svg.on("click", () => {
      this.selectNode(null);
    });
    this.svg.on("mousedown.markmymind", () => {
      this.container.dispatchEvent(new CustomEvent("markmymind-canvas-click", { bubbles: true }));
    });
    this.applyCenter();
  }

  private applyCenter(): void {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2));
  }

  // ─── Renderização Principal ────────────────────────────────────────────────

  render(root: MindNode, layout?: LayoutType): void {
    this.currentRoot = root;
    if (layout) this.currentLayout = normalizeLayout(layout);
    if (!this.initialized) return;

    // Atualiza as cores da árvore baseando-se no esquema configurado
    assignColors(root, this.settings);

    const fontSize = this.settings.fontSize || 12;
    const { positions } = calculateLayout(root, this.currentLayout, fontSize, this.settings.showNoteText, this.settings.nodeWidth, this.settings.maxNodeHeight);

    const rootPos = positions.get(root.id);
    const rootCenterX = rootPos ? (rootPos.x + rootPos.width / 2) : 0;

    const visibleNodes: MindNode[] = [];
    const connections: { parent: MindNode; child: MindNode }[] = [];
    collectVisible(root, visibleNodes, connections);

    this.rootGroup.selectAll(".mm-connection").remove();
    this.rootGroup.selectAll(".mm-node").remove();

    // Conexões curvas/retas/arredondadas
    connections.forEach(({ parent, child }) => {
      if (parent.isVirtualRoot) return; // Não desenha conexões saindo da raiz virtual
      const path = buildPath(
        parent, child, positions, this.currentLayout,
        fontSize, this.settings.showNoteText, this.settings.nodeWidth,
        this.settings.connectionStyle || "rounded",
        this.settings.maxNodeHeight
      );
      if (!path) return;
      this.rootGroup.append("path")
        .attr("class", "mm-connection")
        .attr("data-parent-id", parent.id)
        .attr("data-child-id", child.id)
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", parent.color ?? "#6366f1")
        .attr("stroke-width", this.settings.connectionWidth !== undefined ? this.settings.connectionWidth : 5)
        .attr("stroke-linecap", "round");
    });

    // Nós
    visibleNodes.forEach((node) => {
      if (node.isVirtualRoot) return; // Não renderiza o nó raiz virtual
      const pos = positions.get(node.id);
      if (!pos) return;

      const color = node.color ?? getLevelColor(node.level);
      const isRoot = node.level < 0 || (this.currentRoot?.isVirtualRoot === true && node.level === 0);
      const nodeH = computeNodeHeight(node, fontSize, this.settings.showNoteText, this.settings.nodeWidth, this.settings.maxNodeHeight);
      const nodeW = pos.width;

      const g = this.rootGroup.append("g")
        .attr("class", "mm-node")
        .attr("data-id", node.id)
        .attr("transform", `translate(${pos.x},${pos.y})`)
        .style("cursor", "grab")
        .on("click", (event: MouseEvent) => {
          event.stopPropagation();
          this.handleNodeClick(node.id, event);
        });

      // Habilita Drag and Drop para nós não-raiz
      if (!isRoot) {
        let ghostRect: d3.Selection<SVGRectElement, unknown, null, undefined> | null = null;
        let ghostCircle: d3.Selection<SVGCircleElement, unknown, null, undefined> | null = null;
        let dragTargetNode: { targetId: string; position: "before" | "after" | "inside"; side?: "left" | "right" } | null = null;

        let offsetX = 0;
        let offsetY = 0;
        let dragGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
        let startMouseX = 0;
        let startMouseY = 0;

        const dragBehavior = d3.drag<SVGGElement, unknown>()
          .filter((event) => {
            // Ignora se o clique for com botão direito
            if (event.button !== 0) return false;
            // Ignora se o clique foi em um botão interativo (smart-btn, delete)
            const target = event.target as SVGElement;
            if (
              target.closest(".mm-smart-btn") ||
              target.closest(".mm-delete-btn")
            ) {
              return false;
            }
            return true;
          })
          .on("start", (event) => {
            event.sourceEvent.stopPropagation();
            d3.select(event.sourceEvent.target).style("cursor", "grabbing");

            // Salva coordenadas iniciais do mouse
            startMouseX = event.x;
            startMouseY = event.y;

            // Salva a diferença entre a posição inicial do mouse e o topo-esquerdo do nó
            offsetX = event.x - pos.x;
            offsetY = event.y - pos.y;

            dragGroup = null;
            dragTargetNode = null;
          })
          .on("drag", (event) => {
            // Cria o grupo temporário apenas no primeiro movimento de arraste real
            if (!dragGroup) {
              dragGroup = this.rootGroup.append("g").attr("class", "mm-temp-drag-group");
              dragGroup.raise();

              // Identifica todos os IDs dos nós na subárvore arrastada
              const descendantIds = new Set<string>();
              const collectDescendants = (n: MindNode) => {
                descendantIds.add(n.id);
                if (n.children && !n.collapsed) {
                  n.children.forEach(collectDescendants);
                }
              };
              collectDescendants(node);

              // Move os nós da subárvore para o grupo temporário
              this.rootGroup.selectAll<SVGGElement, unknown>(".mm-node").each(function () {
                const el = d3.select(this);
                const id = el.attr("data-id");
                if (descendantIds.has(id)) {
                  dragGroup!.append(() => this);
                }
              });

              // Move as linhas de conexão correspondentes para o grupo temporário (exceto a que liga ao pai do nó arrastado)
              this.rootGroup.selectAll<SVGPathElement, unknown>(".mm-connection").each(function () {
                const el = d3.select(this);
                const cId = el.attr("data-child-id");
                if (descendantIds.has(cId) && cId !== node.id) {
                  dragGroup!.append(() => this);
                }
              });

              // Oculta temporariamente a linha de conexão com o pai do bloco arrastado
              this.rootGroup.selectAll<SVGPathElement, unknown>(".mm-connection")
                .filter(function () { return d3.select(this).attr("data-child-id") === node.id; })
                .style("opacity", "0");

              // Cria borda pontilhada (pai)
              ghostRect = this.rootGroup.append("rect")
                .attr("stroke-width", 3)
                .attr("stroke-dasharray", "6,6")
                .attr("fill", "none")
                .attr("rx", 10)
                .style("opacity", "0")
                .style("pointer-events", "none");

              // Cria bolinha lateral (irmão)
              ghostCircle = this.rootGroup.append("circle")
                .attr("r", 6)
                .attr("fill", color)
                .attr("stroke", "white")
                .attr("stroke-width", 2)
                .style("opacity", "0")
                .style("pointer-events", "none");
            }

            // Calcula o deslocamento total do mouse
            const dx = event.x - startMouseX;
            const dy = event.y - startMouseY;

            // Move o grupo completo
            if (dragGroup) {
              dragGroup.attr("transform", `translate(${dx},${dy})`);
            }

            // Calcula a posição teórica do bloco arrastado para colisão real
            const dragX = event.x - offsetX;
            const dragY = event.y - offsetY;

            // Coordenadas exatas do ponteiro do mouse
            const mouseX = event.x;
            const mouseY = event.y;

            let bestTarget: any = null;
            let minDistance = Infinity;

            positions.forEach((otherPos, otherId) => {
              if (otherId === node.id) return;

              const isDescendant = (parent: MindNode, searchId: string): boolean => {
                for (const child of parent.children) {
                  if (child.id === searchId) return true;
                  if (isDescendant(child, searchId)) return true;
                }
                return false;
              };
              if (isDescendant(node, otherId)) return;

              const otherNode = visibleNodes.find(n => n.id === otherId);
              if (!otherNode) return;
              const isOtherRoot = otherNode.level < 0;

              const ox = otherPos.x;
              const oy = otherPos.y;
              const ow = otherPos.width;
              const oh = otherPos.height;

              const targetCenterX = ox + ow / 2;
              const targetCenterY = oy + oh / 2;
              const dist = Math.sqrt((mouseX - targetCenterX) ** 2 + (mouseY - targetCenterY) ** 2);

              // 1. Contato Direto (Sobreposição física do bloco arrastado com o núcleo do bloco alvo)
              const insetX = 20;
              const insetY = 12;
              const overlapActual = (
                dragX < (ox + ow - insetX) &&
                dragX + nodeW > (ox + insetX) &&
                dragY < (oy + oh - insetY) &&
                dragY + nodeH > (oy + insetY)
              );

              // 2. Aproximação pelo mouse (Mouse cursor entra na zona de proximidade expandida do bloco alvo)
              const proximityMargin = 50;
              const overlapProximity = (
                mouseX < ox + ow + proximityMargin &&
                mouseX > ox - proximityMargin &&
                mouseY < oy + oh + proximityMargin &&
                mouseY > oy - proximityMargin
              );

              if (overlapActual) {
                // Sobreposição real: drop do tipo "inside" (filho)
                if (!bestTarget || bestTarget.type === "proximity" || dist < minDistance) {
                  minDistance = dist;

                  let dropSide: "left" | "right" | undefined = undefined;
                  if (otherId === this.currentRoot?.id && this.currentLayout === "bidirectional") {
                    dropSide = mouseX < (ox + ow / 2) ? "left" : "right";
                  }

                  bestTarget = {
                    targetId: otherId,
                    position: "inside",
                    type: "actual",
                    rectPos: { x: ox, y: oy, w: ow, h: oh, color: otherNode.color || color },
                    side: dropSide
                  };
                }
              } else if (overlapProximity && !isOtherRoot) {
                // Apenas aproximação do mouse: drop do tipo "before" ou "after" (irmão)
                if (!bestTarget || (bestTarget.type === "proximity" && dist < minDistance)) {
                  minDistance = dist;
                  let match: "before" | "after" = "before";
                  let circlePos = null;

                  const isVertical = this.currentLayout === "down" || this.currentLayout === "up" || this.currentLayout === "vertical";

                  if (isVertical) {
                    if (mouseX < ox + ow / 2) {
                      match = "before";
                      circlePos = { cx: ox, cy: oy + oh / 2 };
                    } else {
                      match = "after";
                      circlePos = { cx: ox + ow, cy: oy + oh / 2 };
                    }
                  } else {
                    if (mouseY < oy + oh / 2) {
                      match = "before";
                      circlePos = { cx: ox + ow / 2, cy: oy };
                    } else {
                      match = "after";
                      circlePos = { cx: ox + ow / 2, cy: oy + oh };
                    }
                  }

                  bestTarget = {
                    targetId: otherId,
                    position: match,
                    type: "proximity",
                    circlePos
                  };
                }
              }
            });

            if (bestTarget && ghostRect && ghostCircle) {
              dragTargetNode = { targetId: bestTarget.targetId, position: bestTarget.position, side: bestTarget.side };
              if (bestTarget.position === "inside") {
                ghostRect
                  .attr("x", bestTarget.rectPos.x - 4)
                  .attr("y", bestTarget.rectPos.y - 4)
                  .attr("width", bestTarget.rectPos.w + 8)
                  .attr("height", bestTarget.rectPos.h + 8)
                  .attr("stroke", bestTarget.rectPos.color)
                  .style("opacity", "1");
                ghostCircle.style("opacity", "0");
              } else {
                ghostCircle
                  .attr("cx", bestTarget.circlePos.cx)
                  .attr("cy", bestTarget.circlePos.cy)
                  .attr("fill", color)
                  .style("opacity", "1");
                ghostRect.style("opacity", "0");
              }
            } else if (ghostRect && ghostCircle) {
              dragTargetNode = null;
              ghostRect.style("opacity", "0");
              ghostCircle.style("opacity", "0");
            }
          })
          .on("end", (event) => {
            d3.select(event.sourceEvent.target).style("cursor", "grab");
            if (ghostRect) { ghostRect.remove(); ghostRect = null; }
            if (ghostCircle) { ghostCircle.remove(); ghostCircle = null; }

            const self = this;
            if (dragTargetNode) {
              this.onNodeMove(node.id, dragTargetNode.targetId, dragTargetNode.position, dragTargetNode.side);
              if (dragGroup) {
                dragGroup.remove();
                dragGroup = null;
              }
            } else {
              // Se soltar no vazio, retorna os elementos do grupo temporário de volta para o rootGroup
              if (dragGroup) {
                const domNode = dragGroup.node();
                if (domNode) {
                  while (domNode.firstChild) {
                    self.rootGroup.node()?.appendChild(domNode.firstChild);
                  }
                }
                dragGroup.remove();
                dragGroup = null;
              }
              // Restaura a opacidade da linha de conexão com o pai
              this.rootGroup.selectAll<SVGPathElement, unknown>(".mm-connection")
                .filter(function () { return d3.select(this).attr("data-child-id") === node.id; })
                .style("opacity", "0.65");
              // Retorna o nó pai para a posição original dele
              g.transition().duration(150)
                .attr("transform", `translate(${pos.x},${pos.y})`);
            }
            dragTargetNode = null;
          });

        g.call(dragBehavior);
      }

      this.renderBlock(g, nodeW, nodeH, color, isRoot, node);
      this.renderMarkdownContent(g, nodeW, nodeH, color, isRoot, node);
      this.renderSmartBtn(g, nodeW, nodeH, color, node, pos, rootCenterX);
      this.renderDeleteBtn(g, nodeW, nodeH, color, node);
      this.bindHoverEvents(g, nodeW, nodeH, color, isRoot, node);
      this.bindEditEvent(g, node, pos);
    });
  }

  // ─── Renderização dos sub-elementos ───────────────────────────────────────

  private renderBlock(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    w: number, h: number, color: string, isRoot: boolean, node: MindNode
  ): void {
    // ClipPath único por nó para evitar overflow de texto
    const clipId = `mm-clip-${node.id}`;
    const svgEl = this.svg.node()!;
    let defs = d3.select(svgEl).select("defs");
    let clip: d3.Selection<any, any, any, any> = defs.select(`#${clipId}`);
    if (clip.empty()) {
      clip = defs.append("clipPath").attr("id", clipId);
      clip.append("rect").attr("rx", 10);
    }
    clip.select("rect")
      .attr("width", w)
      .attr("height", h);

    // Sombra
    g.append("rect")
      .attr("x", 2).attr("y", 3)
      .attr("width", w).attr("height", h)
      .attr("rx", 10)
      .attr("fill", "rgba(0,0,0,0.22)");

    // Corpo principal: Fundo estático sem brilho interno
    g.append("rect")
      .attr("class", "mm-node-bg")
      .attr("width", w).attr("height", h)
      .attr("rx", 10)
      .attr("fill", hexToRgba(color, isRoot ? 0.22 : 0.11));

    // Corpo principal: Bordas (edges) que recebem o brilho/seleção
    const isSelected = this.selectedNodeIds.has(node.id);
    g.append("rect")
      .attr("class", `mm-node-rect ${isSelected ? "selected" : ""}`)
      .attr("width", w).attr("height", h)
      .attr("rx", 10)
      .attr("fill", "none")
      .attr("stroke", isSelected ? "#ffe082" : color)
      .attr("stroke-width", isSelected ? 3.5 : (isRoot ? 2.5 : 1.8));

    // Grupo interno com clip aplicado (contém label e noteText)
    g.append("g")
      .attr("class", "mm-node-content")
      .attr("clip-path", `url(#${clipId})`);

  }

  private renderMarkdownContent(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    w: number, h: number, color: string, isRoot: boolean, node: MindNode
  ): void {
    const fontSize = this.settings.fontSize || 12;
    const labelSize = isRoot ? fontSize + 2 : fontSize;
    const content = g.select<SVGGElement>(".mm-node-content");
    const target = content.empty() ? g : content;

    const fo = target.append("foreignObject")
      .attr("x", 12)
      .attr("y", 10)
      .attr("width", w - 24)
      .attr("height", h - 20)
      .attr("pointer-events", "none");

    const alignClass = `align-${this.settings.textAlign || "titleCenter"}`;
    const body = fo.append("xhtml:div")
      .attr("class", isRoot ? `mm-node-html-wrap is-root ${alignClass}` : `mm-node-html-wrap ${alignClass}`)
      .style("font-family", "var(--font-interface, Inter, sans-serif)")
      .style("font-size", `${fontSize}px`)
      .style("color", "var(--text-normal, #cdd6f4)")
      .style("display", "flex")
      .style("flex-direction", "column")
      .style("height", "100%")
      .style("overflow", "hidden");

    const titleDiv = body.append("div")
      .attr("class", "mm-node-title")
      .style("font-size", `${labelSize}px`)
      .style("font-weight", isRoot || node.level <= 1 ? "600" : "500")
      .style("text-align", "center")
      .style("line-height", "1.35")
      .style("margin", "auto 0")
      .node() as HTMLElement;

    MarkdownRenderer.renderMarkdown(node.label, titleDiv, this.getFilePath(), this.component);

    if (node.noteText && this.settings.showNoteText !== false) {
      titleDiv.style.margin = "0 0 4px 0";

      body.append("div")
        .attr("class", "mm-node-divider")
        .style("height", "1px")
        .style("background", color)
        .style("opacity", "0.3")
        .style("margin", "4px 0");

      const noteSize = Math.max(9, fontSize - 2);
      const isLimitActive = (this.settings.maxNodeHeight || 0) > 0;
      const noteDiv = body.append("div")
        .attr("class", "mm-node-note")
        .style("font-size", `${noteSize}px`)
        .style("color", "var(--text-muted, #a6adc8)")
        .style("text-align", "left")
        .style("overflow-y", isLimitActive ? "auto" : "hidden")
        .style("pointer-events", isLimitActive ? "auto" : "none")
        .style("flex", "1");

      const noteNode = noteDiv.node() as HTMLElement;
      MarkdownRenderer.renderMarkdown(node.noteText, noteNode, this.getFilePath(), this.component);

      if (isLimitActive) {
        noteNode.addEventListener("wheel", (e) => {
          e.stopPropagation();
        }, { passive: true });
      }
    }
  }

  /** Botão de colapso: posição depende do layout */
  /**
   * Botão inteligente unificado:
   * - Sem filhos → botão verde (+), adiciona filho
   * - Com filhos colapsado → botão colorido (+), expande
   * - Com filhos expandido → botão discreto (−), colapsa
   */
  private renderSmartBtn(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    w: number, h: number, color: string, node: MindNode, pos: NodePosition,
    rootCenterX: number
  ): void {
    const isRoot = node.level < 0;
    if (this.currentLayout === "bidirectional" && isRoot) {
      // Raiz bidirecional: botão dos dois lados
      this.drawSmartBtnElement(g, w, h, color, node, pos, false);
      this.drawSmartBtnElement(g, w, h, color, node, pos, true);
    } else {
      const isLeft = this.currentLayout === "bidirectional" && (pos.x + pos.width / 2) < rootCenterX;
      this.drawSmartBtnElement(g, w, h, color, node, pos, isLeft);
    }
  }

  private drawSmartBtnElement(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    w: number, h: number, color: string, node: MindNode, pos: NodePosition,
    isLeft: boolean
  ): void {
    const hasChildren = node.children.length > 0;
    const isCollapsed = node.collapsed;

    // Posição: usa a posição do antigo addBtnPos (próxima ao nó)
    const { cx, cy } = this.addBtnPos(w, h, hasChildren, isLeft);

    // Estado visual inicial:
    // - sem filhos: opacity 0 (aparece no hover)
    // - com filhos colapsado: opacity 1 (sempre visível, sinal de que tem algo)
    // - com filhos expandido: opacity 0.2 (discreto, aparece mais no hover)
    const initialOpacity = hasChildren ? (isCollapsed ? "1" : "0.2") : "0";

    const smartG = g.append("g")
      .attr("class", `mm-smart-btn${hasChildren ? (isCollapsed ? " collapsed" : " expanded") : " leaf"}`)
      .style("opacity", initialOpacity)
      .style("cursor", "pointer")
      .on("click", (event) => {
        event.stopPropagation();
        if (hasChildren) {
          // Tem filhos: toggle colapsar/expandir
          this.onNodeCollapse(node.id);
        } else {
          // Sem filhos: adicionar filho
          this.openAddChildInput(node, pos, isLeft);
        }
      });

    // Cor do fundo:
    // - sem filhos ou colapsado → colorido (cor do nó)
    // - expandido → fundo escuro (discreto)
    const fillColor = (!hasChildren || isCollapsed) ? color : "var(--background-primary, #1e1e2e)";

    smartG.append("circle")
      .attr("cx", cx).attr("cy", cy)
      .attr("r", 20)
      .attr("fill", fillColor)
      .attr("stroke", color)
      .attr("stroke-width", 2.2);

    if (!hasChildren || isCollapsed) {
      // Cruz (+): adicionar ou expandir
      smartG.append("path")
        .attr("d", `M${cx - 10},${cy} L${cx + 10},${cy} M${cx},${cy - 10} L${cx},${cy + 10}`)
        .attr("stroke", "white")
        .attr("stroke-width", 2.8)
        .attr("stroke-linecap", "round");
    } else {
      // Traço (−): colapsar
      smartG.append("path")
        .attr("d", `M${cx - 9},${cy} L${cx + 9},${cy}`)
        .attr("stroke", color)
        .attr("stroke-width", 2.8)
        .attr("stroke-linecap", "round");
    }
  }

  /** Botão de remoção (lixeira/x vermelho): canto superior direito */
  private renderDeleteBtn(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    w: number, h: number, color: string, node: MindNode
  ): void {
    if (node.level < 0) return; // não deleta raiz

    const delG = g.append("g")
      .attr("class", "mm-delete-btn")
      .style("opacity", "0")
      .style("cursor", "pointer")
      .on("click", (event) => {
        event.stopPropagation();
        this.onNodeDelete(node.id);
      });

    delG.append("circle")
      .attr("cx", w - 10).attr("cy", 10)
      .attr("r", 9)
      .attr("fill", "#ef4444")
      .attr("stroke", "var(--background-primary, #1e1e2e)")
      .attr("stroke-width", 1.5);

    delG.append("text")
      .attr("x", w - 10).attr("y", 10 + 1)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "12px").attr("font-weight", "800")
      .attr("fill", "white").attr("pointer-events", "none")
      .text("×");
  }

  private bindHoverEvents(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    w: number, h: number, color: string, isRoot: boolean, node: MindNode
  ): void {
    const self = this;
    g.on("mouseenter", function () {
      const isSelected = self.selectedNodeIds.has(node.id);
      d3.select(this).select(".mm-node-rect")
        .transition().duration(120)
        .attr("stroke-width", isSelected ? 3.5 : (isRoot ? 3.5 : 2.8));
      // Smart button: sempre aparece totalmente no hover
      d3.select(this).selectAll(".mm-smart-btn")
        .transition().duration(150).style("opacity", "1");
      d3.select(this).select(".mm-delete-btn")
        .transition().duration(150).style("opacity", "1");
    }).on("mouseleave", function () {
      const isSelected = self.selectedNodeIds.has(node.id);
      d3.select(this).select(".mm-node-rect")
        .transition().duration(120)
        .attr("stroke-width", isSelected ? 3.5 : (isRoot ? 2.5 : 1.8));
      d3.select(this).select(".mm-delete-btn")
        .transition().duration(150).style("opacity", "0");
      // Smart button: volta ao estado inicial baseado no conteúdo do nó
      const hasChildren = node.children.length > 0;
      const isCollapsed = node.collapsed;
      const restoreOpacity = hasChildren ? (isCollapsed ? "1" : "0.2") : "0";
      d3.select(this).selectAll(".mm-smart-btn")
        .transition().duration(150).style("opacity", restoreOpacity);
    });
  }

  private bindEditEvent(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: MindNode, pos: NodePosition
  ): void {
    g.on("dblclick", (event) => {
      event.stopPropagation();
      this.openNodeEditor(node, pos);
    });

    // Eventos de toque para dispositivos móveis (duplo toque e toque longo)
    let touchTimeout: any = null;
    let lastTap = 0;
    let touchStartX = 0;
    let touchStartY = 0;

    g.on("touchstart", (event: TouchEvent) => {
      if (!event.touches || event.touches.length === 0) return;
      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      const currentTime = Date.now();
      const tapLength = currentTime - lastTap;

      // Duplo Toque
      if (tapLength < 300 && tapLength > 0) {
        event.stopPropagation();
        if (touchTimeout) {
          clearTimeout(touchTimeout);
          touchTimeout = null;
        }
        this.openNodeEditor(node, pos);
        lastTap = 0;
        return;
      }
      lastTap = currentTime;

      // Toque Longo
      if (touchTimeout) clearTimeout(touchTimeout);
      touchTimeout = setTimeout(() => {
        event.stopPropagation();
        this.openNodeEditor(node, pos);
        touchTimeout = null;
      }, 600);
    });

    g.on("touchmove", (event: TouchEvent) => {
      if (!event.touches || event.touches.length === 0) return;
      const touch = event.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      // Se mover o dedo mais que 10px, cancela o toque longo (considera como arraste/scroll)
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        if (touchTimeout) {
          clearTimeout(touchTimeout);
          touchTimeout = null;
        }
      }
    });

    g.on("touchend", () => {
      if (touchTimeout) {
        clearTimeout(touchTimeout);
        touchTimeout = null;
      }
    });

    g.on("touchcancel", () => {
      if (touchTimeout) {
        clearTimeout(touchTimeout);
        touchTimeout = null;
      }
    });
  }

  // ─── Posicionamento layout-dependente ─────────────────────────────────────

  private collapsePos(w: number, h: number, isLeft = false): { cx: number; cy: number } {
    if (this.currentLayout === "right" || this.currentLayout === "horizontal" || this.currentLayout === "bidirectional") {
      return { cx: isLeft ? -64 : w + 64, cy: h / 2 };
    } else if (this.currentLayout === "up") {
      return { cx: w / 2, cy: -64 };
    }
    return { cx: w / 2, cy: h + 64 };
  }

  private addBtnPos(w: number, h: number, hasCollapse: boolean, isLeft = false): { cx: number; cy: number } {
    if (this.currentLayout === "right" || this.currentLayout === "horizontal" || this.currentLayout === "bidirectional") {
      return { cx: isLeft ? -18 : w + 18, cy: h / 2 };
    } else if (this.currentLayout === "up") {
      return { cx: w / 2, cy: -18 };
    }
    return { cx: w / 2, cy: h + 18 };
  }

  // ─── Inputs Inline ────────────────────────────────────────────────────────

  private openAddChildInput(node: MindNode, pos: NodePosition, forceLeft?: boolean): void {
    this.removeInlineEditor();
    this.svg.interrupt();
    const transform = d3.zoomTransform(this.svg.node()!);
    const { k, x, y } = transform;

    const fontSize = this.settings.fontSize || 12;
    const nodeH = computeNodeHeight(node, fontSize, this.settings.showNoteText, this.settings.nodeWidth, this.settings.maxNodeHeight);

    const isLeft = forceLeft !== undefined ? forceLeft : (this.currentLayout === "bidirectional" && (pos.x + pos.width / 2) < 0);
    const inputW = Math.max(160, computeNodeWidth("", fontSize, this.settings.nodeWidth) * k);

    let sx: number, sy: number, sw: number, sh: number;
    const inputH_unscaled = Math.round(fontSize * 3.6);
    if (this.currentLayout === "right" || this.currentLayout === "horizontal" || this.currentLayout === "bidirectional") {
      // Input aparece à DIREITA (ou ESQUERDA se isLeft) do nó, fora da área dos botões e centralizado verticalmente
      if (isLeft) {
        sx = (pos.x - 18) * k + x - inputW;
      } else {
        sx = (pos.x + pos.width + 18) * k + x;
      }
      sy = (pos.y + (nodeH / 2) - (inputH_unscaled / 2)) * k + y;
      sw = inputW;
      sh = inputH_unscaled * k;
    } else if (this.currentLayout === "up") {
      // Input aparece ACIMA do nó, fora da área dos botões
      sx = pos.x * k + x;
      sy = (pos.y - inputH_unscaled - 18) * k + y;
      sw = pos.width * k;
      sh = inputH_unscaled * k;
    } else {
      // Input aparece ABAIXO do nó, fora da área dos botões
      sx = pos.x * k + x;
      sy = (pos.y + nodeH + 18) * k + y;
      sw = pos.width * k;
      sh = inputH_unscaled * k;
    }

    this.createInlineInput({
      x: sx, y: sy, width: sw, height: sh,
      placeholder: "Nome do novo bloco...",
      color: node.color ?? getLevelColor(node.level),
      onCommit: (label) => { if (label) this.onNodeAddChild(node.id, label, forceLeft ? "left" : "right"); },
    });
  }

  private openNodeEditor(node: MindNode, pos: NodePosition): void {
    this.removeInlineEditor();
    this.svg.interrupt();
    const transform = d3.zoomTransform(this.svg.node()!);
    const { k, x, y } = transform;
    const fontSize = this.settings.fontSize || 12;
    const nodeH = computeNodeHeight(node, fontSize, this.settings.showNoteText, this.settings.nodeWidth, this.settings.maxNodeHeight);

    this.createInlineInput({
      x: pos.x * k + x, y: pos.y * k + y,
      width: pos.width * k, height: nodeH * k,
      initialValue: node.noteText ? `${node.label}\n${node.noteText}` : node.label,
      color: node.color ?? getLevelColor(node.level),
      isTextArea: true,
      onCommit: (val) => {
        let newLabel = val;
        let newNote: string | undefined = undefined;
        const firstNewLine = val.indexOf("\n");
        if (firstNewLine !== -1) {
          newLabel = val.substring(0, firstNewLine).trim();
          newNote = val.substring(firstNewLine + 1).trim();
        }
        if (newLabel !== node.label || newNote !== node.noteText) {
          this.onNodeEdit(node.id, newLabel, newNote);
        }
      },
    });
  }

  private removeInlineEditor(): void {
    const old = this.container.querySelector(".mm-inline-editor");
    if (old) old.remove();
    this.isEditing = false;
    this.unlockLayoutAfterEditing();
  }

  private createInlineInput(opts: {
    x: number; y: number; width: number; height: number;
    color: string; placeholder?: string; initialValue?: string;
    isTextArea?: boolean;
    onCommit: (v: string) => void;
  }): void {
    const wrap = document.createElement("div");
    wrap.className = "mm-inline-editor";
    wrap.style.cssText = `position:absolute;left:${opts.x}px;top:${opts.y}px;
      width:${opts.width}px;height:${opts.height}px;z-index:200;`;

    const el = document.createElement(opts.isTextArea ? "textarea" : "input") as HTMLInputElement | HTMLTextAreaElement;
    if (!opts.isTextArea) {
      (el as HTMLInputElement).type = "text";
    }
    el.value = opts.initialValue ?? "";
    el.placeholder = opts.placeholder ?? "";

    const fontSize = this.settings.fontSize || 12;
    el.style.cssText = `width:100%;height:100%;border:2px solid ${opts.color};
      border-radius:10px;padding:8px 12px;font-size:${fontSize}px;line-height:1.4;
      font-family:var(--font-interface,Inter,sans-serif);
      background:var(--background-primary,#1e1e2e);
      color:var(--text-normal,#cdd6f4);outline:none;box-sizing:border-box;resize:none;`;

    wrap.appendChild(el);
    this.container.appendChild(wrap);

    // Marca que estamos editando e trava o layout contra o teclado Android
    this.isEditing = true;
    this.lockLayoutForEditing();

    el.focus({ preventScroll: true });
    if (opts.initialValue) el.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      el.removeEventListener("blur", commit);
      opts.onCommit(el.value.trim());
      wrap.remove();
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (e: Event) => {
      const ev = e as KeyboardEvent;
      if (opts.isTextArea) {
        // No textarea: Ctrl+Enter / Meta+Enter envia; Enter insere nova linha
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          commit();
        }
      } else {
        if (ev.key === "Enter") {
          ev.preventDefault();
          commit();
        }
      }
      if (ev.key === "Escape") {
        el.removeEventListener("blur", commit);
        wrap.remove();
        this.isEditing = false;
        this.unlockLayoutAfterEditing();
      }
    });
  }

  /**
   * Trava o layout inteiro contra o teclado virtual do Android.
   * Funciona em 3 camadas:
   * 1. Trava a ALTURA da view (.markmymind-view) e do workspace em pixels fixos
   *    → impede que o resize do WebView encolha os containers
   * 2. Trava o SCROLL de todos os containers pai
   *    → impede que o Android empurre o conteúdo para cima
   * 3. Adiciona classe CSS para overrides extras via stylesheet
   */
  private lockLayoutForEditing(): void {
    const cleanupFns: (() => void)[] = [];

    // ─── 1. Travar alturas dos containers ────────────────────────────────────
    // Sobe pela cadeia de pais travando cada um na altura atual
    const lockedEls: { el: HTMLElement; origHeight: string; origMinHeight: string; origOverflow: string }[] = [];
    let walker: HTMLElement | null = this.container;
    // Trava: canvas → view (.markmymind-view) → workspace-leaf-content → workspace-leaf
    // Para depois de 4 níveis para não afetar o layout global do Obsidian
    let levels = 0;
    while (walker && levels < 4) {
      const rect = walker.getBoundingClientRect();
      lockedEls.push({
        el: walker,
        origHeight: walker.style.height,
        origMinHeight: walker.style.minHeight,
        origOverflow: walker.style.overflow,
      });
      walker.style.height = `${rect.height}px`;
      walker.style.minHeight = `${rect.height}px`;
      walker.style.overflow = 'clip';
      walker = walker.parentElement;
      levels++;
    }
    cleanupFns.push(() => {
      for (const { el, origHeight, origMinHeight, origOverflow } of lockedEls) {
        el.style.height = origHeight;
        el.style.minHeight = origMinHeight;
        el.style.overflow = origOverflow;
      }
    });

    // ─── 2. Travar scroll em todos os pais ───────────────────────────────────
    const scrollListeners: { target: Element | Window; handler: EventListener }[] = [];
    const lockScroll = (ev: Event) => {
      const t = ev.target as Element;
      if (t && t.scrollTop !== undefined) t.scrollTop = 0;
    };
    let scrollWalker: HTMLElement | null = this.container;
    while (scrollWalker) {
      scrollWalker.scrollTop = 0;
      scrollWalker.addEventListener('scroll', lockScroll, { passive: false });
      scrollListeners.push({ target: scrollWalker, handler: lockScroll });
      scrollWalker = scrollWalker.parentElement;
    }
    const windowLock = () => window.scrollTo(0, 0);
    window.addEventListener('scroll', windowLock, { passive: false });
    scrollListeners.push({ target: window, handler: windowLock });
    cleanupFns.push(() => {
      for (const { target, handler } of scrollListeners) {
        target.removeEventListener('scroll', handler);
      }
    });

    // ─── 3. Classe CSS de segurança ──────────────────────────────────────────
    this.container.classList.add('mm-editing-active');
    const viewEl = this.container.parentElement;
    if (viewEl) viewEl.classList.add('mm-editing-active');
    cleanupFns.push(() => {
      this.container.classList.remove('mm-editing-active');
      if (viewEl) viewEl.classList.remove('mm-editing-active');
    });

    this.layoutLockCleanup = () => {
      for (const fn of cleanupFns) fn();
      cleanupFns.length = 0;
    };
  }

  /** Restaura o layout ao estado original após fechar o editor inline */
  private unlockLayoutAfterEditing(): void {
    if (this.layoutLockCleanup) {
      this.layoutLockCleanup();
      this.layoutLockCleanup = null;
    }
  }

  // ─── Controles Públicos ────────────────────────────────────────────────────

  private findH1Node(node: MindNode): MindNode {
    if (node.level < 0 && node.children.length > 0 && (node.label === "Raiz" || node.label === "Mapa Mental")) {
      return node.children[0];
    }
    return node;
  }

  centerView(): void {
    if (!this.currentRoot) return;
    const targetNode = this.findH1Node(this.currentRoot);
    this.focusOnNode(targetNode.id, true);
  }

  fitView(): void {
    if (!this.currentRoot || !this.initialized) return;
    const fontSize = this.settings.fontSize || 12;
    const { positions } = calculateLayout(
      this.currentRoot,
      this.currentLayout,
      fontSize,
      this.settings.showNoteText,
      this.settings.nodeWidth,
      this.settings.maxNodeHeight
    );

    if (positions.size === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    positions.forEach((pos) => {
      const paddingX = 40;
      const paddingY = 40;

      const x1 = pos.x - paddingX;
      const x2 = pos.x + pos.width + paddingX;
      const y1 = pos.y - paddingY;
      const y2 = pos.y + pos.height + paddingY;

      if (x1 < minX) minX = x1;
      if (x2 > maxX) maxX = x2;
      if (y1 < minY) minY = y1;
      if (y2 > maxY) maxY = y2;
    });

    const mapWidth = maxX - minX;
    const mapHeight = maxY - minY;

    if (mapWidth <= 0 || mapHeight <= 0) return;

    const containerWidth = this.container.clientWidth || 800;
    const containerHeight = this.container.clientHeight || 600;

    const paddingFactor = 0.9;
    const scaleX = (containerWidth * paddingFactor) / mapWidth;
    const scaleY = (containerHeight * paddingFactor) / mapHeight;

    let k = Math.min(scaleX, scaleY);
    k = Math.max(0.08, Math.min(3, k));

    const mapCenterX = minX + mapWidth / 2;
    const mapCenterY = minY + mapHeight / 2;

    const tx = containerWidth / 2 - mapCenterX * k;
    const ty = containerHeight / 2 - mapCenterY * k;

    this.svg.transition().duration(450)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  resize(): void {
    if (this.currentRoot && this.initialized)
      this.render(this.currentRoot, this.currentLayout);
  }

  selectNode(nodeId: string | null): void {
    if (nodeId === null) {
      this.selectedNodeIds.clear();
      this.selectedNodeId = null;
    } else {
      this.selectedNodeIds.clear();
      this.selectedNodeIds.add(nodeId);
      this.selectedNodeId = nodeId;
    }
    if (this.currentRoot) {
      this.render(this.currentRoot, this.currentLayout);
    }
    if (nodeId && this.settings.autoFocusOnSelect) {
      this.focusOnNode(nodeId, true);
    }
  }

  handleNodeClick(nodeId: string, event: MouseEvent): void {
    const isMultiple = event.ctrlKey || event.metaKey;
    const isRange = event.shiftKey;

    if (isMultiple) {
      if (this.selectedNodeIds.has(nodeId)) {
        this.selectedNodeIds.delete(nodeId);
        if (this.selectedNodeId === nodeId) {
          this.selectedNodeId = this.selectedNodeIds.size > 0 ? Array.from(this.selectedNodeIds)[this.selectedNodeIds.size - 1] : null;
        }
      } else {
        this.selectedNodeIds.add(nodeId);
        this.selectedNodeId = nodeId;
      }
    } else if (isRange && this.selectedNodeId && this.currentRoot) {
      const visibleList: string[] = [];
      const collect = (n: MindNode) => {
        if (!n.isVirtualRoot) {
          visibleList.push(n.id);
        }
        if (!n.collapsed) {
          n.children.forEach(collect);
        }
      };
      collect(this.currentRoot);

      const idxStart = visibleList.indexOf(this.selectedNodeId);
      const idxEnd = visibleList.indexOf(nodeId);
      if (idxStart !== -1 && idxEnd !== -1) {
        const start = Math.min(idxStart, idxEnd);
        const end = Math.max(idxStart, idxEnd);
        for (let i = start; i <= end; i++) {
          this.selectedNodeIds.add(visibleList[i]);
        }
      }
      this.selectedNodeId = nodeId;
    } else {
      this.selectedNodeIds.clear();
      this.selectedNodeIds.add(nodeId);
      this.selectedNodeId = nodeId;
    }

    if (this.currentRoot) {
      this.render(this.currentRoot, this.currentLayout);
    }

    if (nodeId && this.settings.autoFocusOnSelect) {
      this.focusOnNode(nodeId, true);
    }
  }

  selectAllNodes(): void {
    if (!this.currentRoot) return;
    this.selectedNodeIds.clear();
    const collect = (node: MindNode) => {
      if (!node.isVirtualRoot) {
        this.selectedNodeIds.add(node.id);
      }
      node.children.forEach(collect);
    };
    collect(this.currentRoot);

    if (this.selectedNodeIds.size > 0) {
      this.selectedNodeId = Array.from(this.selectedNodeIds)[0];
    }

    this.render(this.currentRoot, this.currentLayout);
  }

  focusOnNode(nodeId: string, resetZoom = false): void {
    if (!this.currentRoot) return;
    const fontSize = this.settings.fontSize || 12;
    const { positions } = calculateLayout(
      this.currentRoot,
      this.currentLayout,
      fontSize,
      this.settings.showNoteText,
      this.settings.nodeWidth,
      this.settings.maxNodeHeight
    );
    const pos = positions.get(nodeId);
    if (!pos) return;

    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    const svgNode = this.svg.node();
    let k = 1;
    if (svgNode) {
      try {
        const currentTransform = d3.zoomTransform(svgNode);
        k = resetZoom ? 1 : (currentTransform.k || 1);
      } catch (err) {
        k = 1;
      }
    }

    const tx = w / 2 - (pos.x + pos.width / 2) * k;
    const ty = h / 2 - (pos.y + pos.height / 2) * k;

    // Garante que tx e ty não são NaN ou Infinity
    if (isNaN(tx) || isNaN(ty) || !isFinite(tx) || !isFinite(ty)) {
      return;
    }

    this.svg.transition().duration(450)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  focusOnSelected(): void {
    if (this.selectedNodeId) {
      this.focusOnNode(this.selectedNodeId, true);
    } else {
      new Notice("Nenhum bloco selecionado para focar.");
    }
  }

  addChildToSelected(): void {
    if (!this.selectedNodeId || !this.currentRoot) return;
    const fontSize = this.settings.fontSize || 12;
    const { positions } = calculateLayout(
      this.currentRoot,
      this.currentLayout,
      fontSize,
      this.settings.showNoteText,
      this.settings.nodeWidth,
      this.settings.maxNodeHeight
    );
    const pos = positions.get(this.selectedNodeId);
    if (!pos) return;
    const node = findNodeById(this.currentRoot, this.selectedNodeId);
    if (node) {
      this.openAddChildInput(node, pos);
    }
  }

  navigateWithKeyboard(direction: "up" | "down" | "left" | "right", expandSelection = false): void {
    if (!this.selectedNodeId || !this.currentRoot) return;

    const currentNode = findNodeById(this.currentRoot, this.selectedNodeId);
    if (!currentNode) return;

    const fontSize = this.settings.fontSize || 12;
    let { positions } = calculateLayout(
      this.currentRoot,
      this.currentLayout,
      fontSize,
      this.settings.showNoteText,
      this.settings.nodeWidth,
      this.settings.maxNodeHeight
    );

    // Auto-expande se apontar para os filhos e o nó estiver colapsado
    const isDirectionToChildren = () => {
      if (currentNode.children.length === 0) return false;
      const isRoot = currentNode.id === this.currentRoot!.id;
      if (this.currentLayout === "right" && direction === "right") return true;
      if (this.currentLayout === "down" && direction === "down") return true;
      if (this.currentLayout === "up" && direction === "up") return true;
      if (this.currentLayout === "bidirectional") {
        if (isRoot) return direction === "left" || direction === "right";
        const rootPos = positions.get(this.currentRoot!.id);
        const nodePos = positions.get(currentNode.id);
        if (rootPos && nodePos) {
          const isLeft = nodePos.x < rootPos.x;
          if (isLeft && direction === "left") return true;
          if (!isLeft && direction === "right") return true;
        }
      }
      return false;
    };

    if (currentNode.collapsed && isDirectionToChildren()) {
      currentNode.collapsed = false;
      this.render(this.currentRoot, this.currentLayout);
      // Recarrega as posições após a expansão
      const newLayout = calculateLayout(
        this.currentRoot,
        this.currentLayout,
        fontSize,
        this.settings.showNoteText,
        this.settings.nodeWidth,
        this.settings.maxNodeHeight
      );
      positions = newLayout.positions;
    }

    const currentPos = positions.get(currentNode.id);
    if (!currentPos) return;

    const cx = currentPos.x + currentPos.width / 2;
    const cy = currentPos.y + currentPos.height / 2;

    let bestCandidateId: string | null = null;
    let minScore = Infinity;

    positions.forEach((otherPos, otherId) => {
      if (otherId === currentNode.id) return;

      const ox = otherPos.x + otherPos.width / 2;
      const oy = otherPos.y + otherPos.height / 2;

      let isValid = false;
      let score = Infinity;

      const dx = ox - cx;
      const dy = oy - cy;

      if (direction === "left") {
        if (ox < cx - 1) {
          isValid = true;
          score = dx * dx + 4.5 * dy * dy;
        }
      } else if (direction === "right") {
        if (ox > cx + 1) {
          isValid = true;
          score = dx * dx + 4.5 * dy * dy;
        }
      } else if (direction === "up") {
        if (oy < cy - 1) {
          isValid = true;
          score = 4.5 * dx * dx + dy * dy;
        }
      } else if (direction === "down") {
        if (oy > cy + 1) {
          isValid = true;
          score = 4.5 * dx * dx + dy * dy;
        }
      }

      if (isValid && score < minScore) {
        minScore = score;
        bestCandidateId = otherId;
      }
    });

    if (bestCandidateId) {
      if (expandSelection) {
        this.selectedNodeIds.add(bestCandidateId);
        this.selectedNodeId = bestCandidateId;
        if (this.currentRoot) {
          this.render(this.currentRoot, this.currentLayout);
        }
      } else {
        this.selectNode(bestCandidateId);
      }
    }
  }

  destroy(): void {
    this.container.innerHTML = "";
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function collectVisible(
  node: MindNode,
  nodes: MindNode[],
  connections: { parent: MindNode; child: MindNode }[]
): void {
  nodes.push(node);
  if (node.collapsed) return;
  for (const child of node.children) {
    connections.push({ parent: node, child });
    collectVisible(child, nodes, connections);
  }
}

function buildPath(
  parent: MindNode, child: MindNode,
  positions: Map<string, NodePosition>, layout: LayoutType, fontSize: number, showNoteText: boolean, nodeWidth = 0,
  connectionStyle: "curved" | "rounded" | "straight" = "rounded",
  maxNodeHeight = 0
): string {
  const p = positions.get(parent.id);
  const c = positions.get(child.id);
  if (!p || !c) return "";

  const pH = computeNodeHeight(parent, fontSize, showNoteText, nodeWidth, maxNodeHeight);
  const cH = computeNodeHeight(child, fontSize, showNoteText, nodeWidth, maxNodeHeight);

  const normLayout = normalizeLayout(layout);

  if (normLayout === "right" || normLayout === "bidirectional") {
    const isLeft = c.x < p.x;
    const sx = isLeft ? p.x : p.x + p.width;
    const sy = p.y + pH / 2;
    const tx = isLeft ? c.x + c.width : c.x;
    const ty = c.y + cH / 2;

    if (connectionStyle === "straight") {
      return `M${sx},${sy} L${tx},${ty}`;
    } else if (connectionStyle === "rounded") {
      const mx = (sx + tx) / 2;
      const dy = ty - sy;
      const dx = tx - sx;
      const signX = dx >= 0 ? 1 : -1;
      const signY = dy >= 0 ? 1 : -1;
      const r = 12;
      const absDx = Math.abs(mx - sx);
      const absDy = Math.abs(dy);
      const actualR = Math.min(r, absDx, absDy);

      if (actualR <= 1) {
        return `M${sx},${sy} L${mx},${sy} L${mx},${ty} L${tx},${ty}`;
      }
      return `M${sx},${sy} L${mx - actualR * signX},${sy} Q${mx},${sy} ${mx},${sy + actualR * signY} L${mx},${ty - actualR * signY} Q${mx},${ty} ${mx + actualR * signX},${ty} L${tx},${ty}`;
    } else {
      // curved (padrão)
      const mx = (sx + tx) / 2;
      return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
    }
  } else if (normLayout === "down") {
    const sx = p.x + p.width / 2, sy = p.y + pH;
    const tx = c.x + c.width / 2, ty = c.y;

    if (connectionStyle === "straight") {
      return `M${sx},${sy} L${tx},${ty}`;
    } else if (connectionStyle === "rounded") {
      const my = (sy + ty) / 2;
      const dy = ty - sy;
      const dx = tx - sx;
      const signX = dx >= 0 ? 1 : -1;
      const signY = dy >= 0 ? 1 : -1;
      const r = 12;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(my - sy);
      const actualR = Math.min(r, absDx, absDy);

      if (actualR <= 1) {
        return `M${sx},${sy} L${sx},${my} L${tx},${my} L${tx},${ty}`;
      }
      return `M${sx},${sy} L${sx},${my - actualR * signY} Q${sx},${my} ${sx + actualR * signX},${my} L${tx - actualR * signX},${my} Q${tx},${my} ${tx},${my + actualR * signY} L${tx},${ty}`;
    } else {
      // curved (padrão)
      const my = (sy + ty) / 2;
      return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
    }
  } else if (normLayout === "up") {
    const sx = p.x + p.width / 2, sy = p.y;
    const tx = c.x + c.width / 2, ty = c.y + cH;

    if (connectionStyle === "straight") {
      return `M${sx},${sy} L${tx},${ty}`;
    } else if (connectionStyle === "rounded") {
      const my = (sy + ty) / 2;
      const dy = ty - sy;
      const dx = tx - sx;
      const signX = dx >= 0 ? 1 : -1;
      const signY = dy >= 0 ? 1 : -1;
      const r = 12;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(my - sy);
      const actualR = Math.min(r, absDx, absDy);

      if (actualR <= 1) {
        return `M${sx},${sy} L${sx},${my} L${tx},${my} L${tx},${ty}`;
      }
      return `M${sx},${sy} L${sx},${my - actualR * signY} Q${sx},${my} ${sx + actualR * signX},${my} L${tx - actualR * signX},${my} Q${tx},${my} ${tx},${my + actualR * signY} L${tx},${ty}`;
    } else {
      // curved (padrão)
      const my = (sy + ty) / 2;
      return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
    }
  } else {
    const sx = p.x + p.width / 2, sy = p.y + pH / 2;
    const tx = c.x + c.width / 2, ty = c.y + cH / 2;
    if (connectionStyle === "straight") {
      return `M${sx},${sy} L${tx},${ty}`;
    } else {
      const mx = (sx + tx) / 2, my = (sy + ty) / 2 - 20;
      return `M${sx},${sy} Q${mx},${my} ${tx},${ty}`;
    }
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return `rgba(99,102,241,${alpha})`;
  return `rgba(${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)},${alpha})`;
}
