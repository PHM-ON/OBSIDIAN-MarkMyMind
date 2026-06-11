/**
 * MindMapToMd.ts
 * Converte a árvore de nós do MindMap de volta para Markdown estruturado.
 */

import { MindNode } from "./MarkdownParser";

/**
 * Converte a árvore de nós em string Markdown.
 * Se o layout for bidirectional, agrupa os filhos diretos sob "## <<" e "## >>".
 */
export function mindMapToMarkdown(root: MindNode, layout?: string): string {
  const lines: string[] = [];
  const isBidirectional = layout === "bidirectional";

  // Escreve a raiz se não for virtual e não for uma raiz virtual promovida
  // (raiz virtual promovida = tinha múltiplos H1s, que mantêm seus níveis originais)
  const isPromotedVirtualRoot = !root.isVirtualRoot && root.children.some(c => c.level === 0);
  if (!root.isVirtualRoot && !isPromotedVirtualRoot) {
    lines.push(`# ${root.label}`);
    if (root.noteText) {
      lines.push("");
      lines.push(root.noteText);
    }
    lines.push("");
  }

  if (isBidirectional) {
    const leftChildren: MindNode[] = [];
    const rightChildren: MindNode[] = [];

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

    // Seção da Esquerda (<<)
    if (leftChildren.length > 0) {
      lines.push("## <<");
      lines.push("");
      for (const child of leftChildren) {
        convertNodeWithLevelOffset(child, lines, 1);
      }
    }

    // Seção da Direita (>>)
    if (rightChildren.length > 0) {
      lines.push("## >>");
      lines.push("");
      for (const child of rightChildren) {
        convertNodeWithLevelOffset(child, lines, 1);
      }
    }
  } else {
    for (const child of root.children) {
      convertNodeWithLevelOffset(child, lines, 0);
    }
  }

  return lines.join("\n");
}

function convertNodeWithLevelOffset(node: MindNode, lines: string[], offset: number): void {
  const headingLevel = (node.level + 1) + offset;

  if (headingLevel <= 6) {
    const prefix = "#".repeat(headingLevel);
    lines.push(`${prefix} ${node.label}`);
    if (node.noteText) {
      lines.push("");
      lines.push(node.noteText);
    }
    lines.push("");
  }

  for (const child of node.children) {
    convertNodeWithLevelOffset(child, lines, offset);
  }
}

/**
 * Gera markdown de uma subárvore (útil para exportar parte do mapa)
 */
export function subtreeToMarkdown(node: MindNode, startLevel = 1): string {
  const lines: string[] = [];
  subtreeToLines(node, lines, startLevel);
  return lines.join("\n");
}

function subtreeToLines(node: MindNode, lines: string[], headingLevel: number): void {
  const prefix = "#".repeat(Math.min(headingLevel, 6));

  lines.push(`${prefix} ${node.label}`);
  if (node.noteText) {
    lines.push("");
    lines.push(node.noteText);
  }
  lines.push("");
  for (const child of node.children) {
    subtreeToLines(child, lines, headingLevel + 1);
  }
}
