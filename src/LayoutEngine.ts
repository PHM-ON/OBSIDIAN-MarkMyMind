/**
 * LayoutEngine.ts
 * Calcula posições X,Y de cada nó do mapa mental.
 * Altura dos blocos é calculada dinamicamente pelo conteúdo (label + noteText) e fontSize.
 */

import { MindNode } from "./MarkdownParser";

export type LayoutType = "right" | "down" | "bidirectional" | "up" | "horizontal" | "vertical";

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  positions: Map<string, NodePosition>;
  totalWidth: number;
  totalHeight: number;
}

const H_GAP = 100;
const V_GAP = 42;

/** Largura do bloco estimada pelo label e pelo tamanho da fonte */
export function computeNodeWidth(label: string, fontSize = 12, nodeWidth = 0): number {
  if (nodeWidth > 0) {
    return nodeWidth;
  }
  const charW = fontSize * 0.7; // estima largura média de char com base no fontSize
  return Math.max(200, Math.min(label.length * charW + 32, 350));
}

/**
 * Quebra texto em linhas respeitando largura máxima de caracteres e quebras de linha (\n).
 * Palavras maiores que charsPerLine são quebradas por caractere.
 */
export function wrapText(text: string, charsPerLine: number): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";

    for (const word of words) {
      if (word.length > charsPerLine) {
        if (current) { lines.push(current); current = ""; }
        for (let i = 0; i < word.length; i += charsPerLine) {
          lines.push(word.slice(i, i + charsPerLine));
        }
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > charsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Altura do bloco: calculada dinamicamente usando a mesma função wrapText e o tamanho da fonte.
 */
export function computeNodeHeight(
  node: MindNode,
  fontSize = 12,
  showNoteText = true,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): number {
  const isRoot = node.level < 0;
  const labelSize = isRoot ? fontSize + 2 : fontSize;
  const blockWidth = computeNodeWidth(node.label, fontSize, node.level < 0 ? 0 : nodeWidth);

  // Título (label)
  const charWLabel = labelSize * 0.55;
  const charsPerLineLabel = Math.max(10, Math.floor((blockWidth - 24) / charWLabel));
  const labelLines = wrapText(node.label, charsPerLineLabel).length;
  const lineHLabel = Math.round(labelSize * 1.3);

  const isSelected = selectedNodeIds.has(node.id);
  const shouldShowNote = node.noteText && (showNoteText || (autoExpandSelected && isSelected));

  if (!shouldShowNote) {
    // Apenas título
    const labelPadding = Math.round(fontSize * 1.5);
    const calculatedH = labelLines * lineHLabel + labelPadding;
    const finalH = Math.max(Math.round(fontSize * 3.5), calculatedH);
    return maxNodeHeight > 0 ? Math.min(finalH, maxNodeHeight) : finalH;
  } else {
    // Título + Nota
    const labelPadding = Math.round(fontSize * 1.2);
    const titleH = labelLines * lineHLabel + labelPadding;

    const noteText = node.noteText || "";

    // Nota
    const noteSize = Math.max(9, fontSize - 2);
    const charWNote = noteSize * 0.52;
    const charsPerLineNote = Math.max(12, Math.floor((blockWidth - 24) / charWNote));
    const noteLines = wrapText(noteText, charsPerLineNote).length;
    const lineHNote = Math.round(noteSize * 1.25);
    const notePadding = Math.round(fontSize * 1.2);

    const sepY = titleH + Math.round(labelSize * 0.6);
    const startYNote = sepY + noteSize;
    const calculatedH = startYNote + (noteLines - 1) * lineHNote + notePadding;

    // --- BÚFERES DE ALTURA EXTRA PARA ELEMENTOS ESPECÍFICOS DE MARKDOWN ---
    let extraHeight = 0;

    // 1. Codeblocks: triple backticks
    const codeBlockCount = (noteText.match(/```/g) || []).length;
    const numCodeBlocks = Math.floor(codeBlockCount / 2);
    if (numCodeBlocks > 0) {
      extraHeight += numCodeBlocks * 30; // 30px extra por bloco de código (margem/padding)
    }

    // 2. Callouts: linhas com "> [!" ou ">[! "
    const calloutCount = (noteText.match(/^\s*>\s*\[!/gm) || []).length;
    if (calloutCount > 0) {
      extraHeight += calloutCount * 45; // 45px extra por callout (título, ícone, padding)
    }

    // 3. Listas (UL/OL): adiciona pequeno espaçamento por item
    const listItemCount = (noteText.match(/^\s*[-*+]\s+/gm) || []).length + (noteText.match(/^\s*\d+\.\s+/gm) || []).length;
    if (listItemCount > 0) {
      extraHeight += listItemCount * 4;
    }

    const finalH = calculatedH + extraHeight;
    return maxNodeHeight > 0 ? Math.min(finalH, maxNodeHeight) : finalH;
  }
}

/** Ponto de entrada: calcula o layout */
export function normalizeLayout(layout: any): LayoutType {
  if (layout === "horizontal") return "right";
  if (layout === "vertical") return "down";
  if (layout === "right" || layout === "down" || layout === "bidirectional" || layout === "up") return layout;
  return "right";
}

export function calculateLayout(
  root: MindNode,
  type: LayoutType,
  fontSize = 12,
  showNoteText = true,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): LayoutResult {
  const normType = normalizeLayout(type);

  if (root.isVirtualRoot) {
    const positions = new Map<string, NodePosition>();
    let currentY = 0;
    const gap = 120; // Espaço vertical confortável entre os mapas empilhados

    if (root.children.length === 0) {
      return { positions, totalWidth: 0, totalHeight: 0 };
    }

    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i];
      const originalLevel = child.level;
      child.level = -1; // trata como raiz temporária para o cálculo do sub-layout
      const childResult = calculateLayout(child, type, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
      child.level = originalLevel;

      let minChildY = Infinity;
      let maxChildY = -Infinity;
      for (const p of childResult.positions.values()) {
        minChildY = Math.min(minChildY, p.y);
        maxChildY = Math.max(maxChildY, p.y + p.height);
      }
      const childHeight = maxChildY - minChildY;
      const offsetY = currentY - minChildY;

      let offsetX = 0;
      if (normType === "down" || normType === "up" || normType === "bidirectional") {
        const childRootPos = childResult.positions.get(child.id);
        if (childRootPos) {
          offsetX = -(childRootPos.x + childRootPos.width / 2);
        }
      }

      for (const [id, pos] of childResult.positions.entries()) {
        positions.set(id, {
          id: pos.id,
          x: pos.x + offsetX,
          y: pos.y + offsetY,
          width: pos.width,
          height: pos.height
        });
      }
      currentY += childHeight + gap;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.width);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y + p.height);
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    positions.set(root.id, { id: root.id, x: centerX, y: centerY, width: 0, height: 0 });

    return {
      positions,
      totalWidth: maxX - minX,
      totalHeight: maxY - minY
    };
  }

  switch (normType) {
    case "right": return layoutHorizontal(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    case "down": return layoutVertical(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    case "up": return layoutUp(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    case "bidirectional": return layoutBidirectional(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    default: return layoutHorizontal(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  }
}

// ─── LAYOUT HORIZONTAL ───────────────────────────────────────────────────────

function layoutHorizontal(
  root: MindNode,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): LayoutResult {
  const positions = new Map<string, NodePosition>();
  const subtreeHeights = buildSubtreeHeights(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  placeH(root, 0, 0, positions, subtreeHeights, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  // Centraliza o root verticalmente em y = 0
  const rootPos = positions.get(root.id);
  if (rootPos) {
    const offsetY = -(rootPos.y + rootPos.height / 2);
    for (const pos of positions.values()) {
      pos.y += offsetY;
    }
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.width);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + p.height);
  }
  return { positions, totalWidth: maxX - minX, totalHeight: maxY - minY };
}

function placeH(
  node: MindNode,
  x: number,
  startY: number,
  positions: Map<string, NodePosition>,
  subtreeHeights: Map<string, number>,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): number {
  const selfH = computeNodeHeight(node, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  const subtreeH = subtreeHeights.get(node.id) ?? selfH;
  const selfY = startY + Math.max(0, (subtreeH - selfH) / 2);
  const w = computeNodeWidth(node.label, fontSize, node.level < 0 ? 0 : nodeWidth);

  positions.set(node.id, { id: node.id, x, y: selfY, width: w, height: selfH });

  if (node.children.length === 0 || node.collapsed) return subtreeH;

  let total = 0;
  node.children.forEach((child, i) => {
    total += (subtreeHeights.get(child.id) ?? 0) + (i < node.children.length - 1 ? V_GAP : 0);
  });

  let childY = startY;
  if (total < selfH) {
    childY = selfY + (selfH - total) / 2;
  }

  const childX = x + w + H_GAP;
  for (const child of node.children) {
    const ch = placeH(child, childX, childY, positions, subtreeHeights, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    childY += ch + V_GAP;
  }
  return subtreeH;
}

// ─── LAYOUT VERTICAL ─────────────────────────────────────────────────────────

function layoutVertical(
  root: MindNode,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): LayoutResult {
  const positions = new Map<string, NodePosition>();
  const subtreeWidths = buildSubtreeWidths(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  placeV(root, 0, 0, positions, subtreeWidths, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  // Centraliza o root horizontalmente em x = 0 para manter o root fixo
  const rootPos = positions.get(root.id);
  if (rootPos) {
    const offsetX = -(rootPos.x + rootPos.width / 2);
    for (const pos of positions.values()) {
      pos.x += offsetX;
    }
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.width);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + p.height);
  }
  return { positions, totalWidth: maxX - minX, totalHeight: maxY - minY };
}

function placeV(
  node: MindNode,
  startX: number,
  y: number,
  positions: Map<string, NodePosition>,
  subtreeWidths: Map<string, number>,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): void {
  const selfH = computeNodeHeight(node, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  const nodeW = subtreeWidths.get(node.id) ?? 160;
  const w = computeNodeWidth(node.label, fontSize, node.level < 0 ? 0 : nodeWidth);
  const selfX = startX + Math.max(0, (nodeW - w) / 2);

  positions.set(node.id, { id: node.id, x: selfX, y, width: w, height: selfH });

  if (node.children.length === 0 || node.collapsed) return;

  const childY = y + selfH + H_GAP;
  let childX = startX;
  for (const child of node.children) {
    const cw = subtreeWidths.get(child.id) ?? (nodeWidth > 0 ? nodeWidth : 200);
    placeV(child, childX, childY, positions, subtreeWidths, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    childX += cw + V_GAP;
  }
}

// ─── LAYOUT UP ───────────────────────────────────────────────────────────────

function layoutUp(
  root: MindNode,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): LayoutResult {
  const positions = new Map<string, NodePosition>();
  const subtreeWidths = buildSubtreeWidths(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  placeUp(root, 0, 0, positions, subtreeWidths, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  // Centraliza o root horizontalmente em x = 0 para manter o root fixo
  const rootPos = positions.get(root.id);
  if (rootPos) {
    const offsetX = -(rootPos.x + rootPos.width / 2);
    for (const pos of positions.values()) {
      pos.x += offsetX;
    }
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.width);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + p.height);
  }
  return { positions, totalWidth: maxX - minX, totalHeight: maxY - minY };
}

function placeUp(
  node: MindNode,
  startX: number,
  y: number,
  positions: Map<string, NodePosition>,
  subtreeWidths: Map<string, number>,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): void {
  const selfH = computeNodeHeight(node, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  const nodeW = subtreeWidths.get(node.id) ?? 160;
  const w = computeNodeWidth(node.label, fontSize, node.level < 0 ? 0 : nodeWidth);
  const selfX = startX + Math.max(0, (nodeW - w) / 2);

  positions.set(node.id, { id: node.id, x: selfX, y, width: w, height: selfH });

  if (node.children.length === 0 || node.collapsed) return;

  let childX = startX;
  for (const child of node.children) {
    const cw = subtreeWidths.get(child.id) ?? (nodeWidth > 0 ? nodeWidth : 200);
    const childSelfH = computeNodeHeight(child, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    const childY = y - H_GAP - childSelfH;
    placeUp(child, childX, childY, positions, subtreeWidths, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    childX += cw + V_GAP;
  }
}

// ─── LAYOUT BIDIRECTIONAL ────────────────────────────────────────────────────

function layoutBidirectional(
  root: MindNode,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): LayoutResult {
  const positions = new Map<string, NodePosition>();
  const subtreeHeights = buildSubtreeHeights(root, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);

  // Divide os filhos entre direita e esquerda de acordo com o lado marcado (side),
  // ou alternando por índice se não estiver definido para manter compatibilidade.
  const rightChildren: MindNode[] = [];
  const leftChildren: MindNode[] = [];
  root.children.forEach((child, idx) => {
    if (child.side === "left") {
      leftChildren.push(child);
    } else if (child.side === "right") {
      rightChildren.push(child);
    } else {
      if (idx % 2 === 0) {
        rightChildren.push(child);
      } else {
        leftChildren.push(child);
      }
    }
  });

  // Calcula a altura acumulada de cada lado
  let rightSubtreeHeight = 0;
  rightChildren.forEach((child, i) => {
    const ch = subtreeHeights.get(child.id) ?? computeNodeHeight(child, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    rightSubtreeHeight += ch + (i < rightChildren.length - 1 ? V_GAP : 0);
  });

  let leftSubtreeHeight = 0;
  leftChildren.forEach((child, i) => {
    const ch = subtreeHeights.get(child.id) ?? computeNodeHeight(child, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    leftSubtreeHeight += ch + (i < leftChildren.length - 1 ? V_GAP : 0);
  });

  // Posiciona a raiz no centro (0, 0)
  const rootW = computeNodeWidth(root.label, fontSize, 0);
  const rootH = computeNodeHeight(root, fontSize, showNoteText, 0, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  positions.set(root.id, { id: root.id, x: -rootW / 2, y: -rootH / 2, width: rootW, height: rootH });

  // Posiciona lado direito (cresce para x positivo)
  let rightY = -rightSubtreeHeight / 2;
  const rightX = rootW / 2 + H_GAP;
  rightChildren.forEach((child) => {
    placeH(child, rightX, rightY, positions, subtreeHeights, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    const ch = subtreeHeights.get(child.id) ?? computeNodeHeight(child, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    rightY += ch + V_GAP;
  });

  // Posiciona lado esquerdo (cresce para x negativo)
  let leftY = -leftSubtreeHeight / 2;
  const leftX = -rootW / 2;
  leftChildren.forEach((child) => {
    placeLeft(child, leftX, leftY, positions, subtreeHeights, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    const ch = subtreeHeights.get(child.id) ?? computeNodeHeight(child, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    leftY += ch + V_GAP;
  });

  // Calcula limites totais
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }

  return { positions, totalWidth: maxX - minX, totalHeight: maxY - minY };
}

function placeLeft(
  node: MindNode,
  parentX: number,
  startY: number,
  positions: Map<string, NodePosition>,
  subtreeHeights: Map<string, number>,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): number {
  const selfH = computeNodeHeight(node, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  const subtreeH = subtreeHeights.get(node.id) ?? selfH;
  const selfY = startY + Math.max(0, (subtreeH - selfH) / 2);
  const w = computeNodeWidth(node.label, fontSize, nodeWidth);

  const x = parentX - H_GAP - w;
  positions.set(node.id, { id: node.id, x, y: selfY, width: w, height: selfH });

  if (node.children.length === 0 || node.collapsed) return subtreeH;

  let total = 0;
  node.children.forEach((child, i) => {
    total += (subtreeHeights.get(child.id) ?? 0) + (i < node.children.length - 1 ? V_GAP : 0);
  });

  let childY = startY;
  if (total < selfH) {
    childY = selfY + (selfH - total) / 2;
  }

  const childX = x;
  for (const child of node.children) {
    const ch = placeLeft(child, childX, childY, positions, subtreeHeights, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
    childY += ch + V_GAP;
  }
  return subtreeH;
}

// ─── HELPERS: SUBTREE DIMENSIONS ─────────────────────────────────────────────

function buildSubtreeHeights(
  root: MindNode,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): Map<string, number> {
  const map = new Map<string, number>();
  calcSH(root, map, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  return map;
}

function calcSH(
  node: MindNode,
  map: Map<string, number>,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): number {
  const selfH = computeNodeHeight(node, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  if (node.children.length === 0 || node.collapsed) { map.set(node.id, selfH); return selfH; }
  const total = node.children.reduce(
    (sum, c, i) => sum + calcSH(c, map, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds) + (i < node.children.length - 1 ? V_GAP : 0), 0
  );
  const h = Math.max(selfH, total);
  map.set(node.id, h);
  return h;
}

// ─── SUBTREE WIDTHS ───

function buildSubtreeWidths(
  root: MindNode,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): Map<string, number> {
  const map = new Map<string, number>();
  calcSW(root, map, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds);
  return map;
}

function calcSW(
  node: MindNode,
  map: Map<string, number>,
  fontSize: number,
  showNoteText: boolean,
  nodeWidth = 0,
  maxNodeHeight = 0,
  autoExpandSelected = false,
  selectedNodeIds: Set<string> = new Set()
): number {
  const selfW = computeNodeWidth(node.label, fontSize, nodeWidth);
  if (node.children.length === 0 || node.collapsed) { map.set(node.id, selfW); return selfW; }
  const total = node.children.reduce(
    (sum, c, i) => sum + calcSW(c, map, fontSize, showNoteText, nodeWidth, maxNodeHeight, autoExpandSelected, selectedNodeIds) + (i < node.children.length - 1 ? V_GAP : 0), 0
  );
  const w = Math.max(selfW, total);
  map.set(node.id, w);
  return w;
}
