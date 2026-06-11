/**
 * MarkdownParser.ts
 * Converte conteúdo Markdown em árvore de nós do MindMap e vice-versa.
 */

export interface MindNode {
  id: string;
  label: string;
  level: number;       // 0=H1, 1=H2, 2=H3, 3=H4, 4=H5, 5=H6, 6+=lista
  children: MindNode[];
  color?: string;
  emoji?: string;
  collapsed: boolean;
  noteText?: string;   // Parágrafos abaixo do heading (contexto extra)
  side?: "left" | "right";
  isVirtualRoot?: boolean;
}

let nodeCounter = 0;
function generateId(): string {
  return `node-${Date.now()}-${nodeCounter++}`;
}

/** Nível de cor padrão por profundidade */
const DEFAULT_COLORS: string[] = [
  "#6366f1", // H1 - índigo
  "#8b5cf6", // H2 - violeta
  "#06b6d4", // H3 - ciano
  "#10b981", // H4 - esmeralda
  "#f59e0b", // H5 - âmbar
  "#ef4444", // H6 - vermelho
  "#ec4899", // lista-1 - rosa
  "#a855f7", // lista-2 - roxo
];

export function getLevelColor(level: number): string {
  return DEFAULT_COLORS[Math.min(level, DEFAULT_COLORS.length - 1)];
}

/**
 * Analisa o markdown e retorna a raiz da árvore de nós.
 * Suporta headings (# a ####) e listas (-, *, números).
 */
export function parseMarkdown(markdown: string, singleH1Root: boolean = true): MindNode {
  const lines = markdown.split("\n");
  nodeCounter = 0;

  // Nó raiz fictício para agrupar tudo
  const root: MindNode = {
    id: generateId(),
    label: "Raiz",
    level: -1,
    children: [],
    collapsed: false,
    isVirtualRoot: true,
  };

  const stack: MindNode[] = [root];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const textLine = line.trim();

    // Detecta início/fim de bloco de código
    const isCodeBlockDelimiter = textLine.startsWith("```") || textLine.startsWith("~~~");
    if (isCodeBlockDelimiter) {
      inCodeBlock = !inCodeBlock;
    }

    // Heading: # ## ### #### ##### ###### (apenas se NÃO estiver dentro de um bloco de código)
    const headingMatch = !inCodeBlock && !isCodeBlockDelimiter && line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length - 1; // 0=H1, 1=H2, 2=H3, 3=H4, 4=H5, 5=H6
      let label = headingMatch[2].trim();

      const node: MindNode = {
        id: generateId(),
        label,
        level,
        children: [],
        color: getLevelColor(level),
        collapsed: false,
      };

      // Encontra o pai correto na pilha
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }

    // Parágrafo (inclui listas, bullet points e qualquer outro texto): associa ao nó atual como nota
    if (stack.length <= 1) continue;

    const currentNode = stack[stack.length - 1];
    if (currentNode.level < 0) continue;

    if (!textLine) {
      if (currentNode.noteText && !currentNode.noteText.endsWith("\n")) {
        currentNode.noteText += "\n";
      }
      continue;
    }

    // Preserva a linha original com sua indentação
    currentNode.noteText = currentNode.noteText
      ? `${currentNode.noteText}\n${line}`
      : line;
  }

  // Limpeza recursiva de noteText (remove quebras de linha extras no início/fim de cada nó)
  function cleanNoteTexts(node: MindNode): void {
    if (node.noteText) {
      node.noteText = node.noteText.trim();
    }
    for (const child of node.children) {
      cleanNoteTexts(child);
    }
  }

  // Se a raiz tem apenas um filho H1, essa é a raiz real
  let realRoot = root;
  if (singleH1Root) {
    if (root.children.length === 1 && root.children[0].level === 0) {
      realRoot = root.children[0];
      realRoot.level = -1; // trata como raiz
      realRoot.isVirtualRoot = false;
    } else {
      root.label = "Mapa Mental";
      root.isVirtualRoot = false;
    }
  } else {
    root.label = "Mapa Mental";
    root.isVirtualRoot = true;
  }

  // Pós-processamento: promover os filhos de << e >> para a raiz e definir seus lados
  const finalChildren: MindNode[] = [];
  
  const adjustLevelsAndPropagateSide = (n: MindNode, levelDelta: number, side: "left" | "right") => {
    n.level += levelDelta;
    n.side = side;
    n.color = getLevelColor(n.level);
    for (const child of n.children) {
      adjustLevelsAndPropagateSide(child, levelDelta, side);
    }
  };

  for (const child of realRoot.children) {
    if (child.level === 1 && (child.label === "<<" || child.label === ">>")) {
      const side: "left" | "right" = child.label === "<<" ? "left" : "right";
      for (const subChild of child.children) {
        adjustLevelsAndPropagateSide(subChild, -1, side);
        finalChildren.push(subChild);
      }
    } else {
      finalChildren.push(child);
    }
  }

  realRoot.children = finalChildren;
  cleanNoteTexts(realRoot);
  return realRoot;
}

/** Conta total de nós na árvore */
export function countNodes(node: MindNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** Busca um nó por ID */
export function findNodeById(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/** Atualiza o label e o noteText de um nó por ID, retorna true se encontrou */
export function updateNodeContent(root: MindNode, id: string, newLabel: string, newNote?: string): boolean {
  const node = findNodeById(root, id);
  if (node) {
    node.label = newLabel;
    node.noteText = newNote && newNote.trim() ? newNote.trim() : undefined;
    return true;
  }
  return false;
}

/** Remove um nó por ID da árvore recursivamente, retorna true se removeu */
export function deleteNodeById(root: MindNode, id: string): boolean {
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) {
      root.children.splice(i, 1);
      return true;
    }
    const deleted = deleteNodeById(root.children[i], id);
    if (deleted) return true;
  }
  return false;
}

/** Recalcula as cores da árvore de nós baseando-se no esquema configurado */
export function assignColors(root: MindNode, settings: any): void {
  const mode = settings.colorMode || "level";
  const baseColors = [
    settings.colorH1 || "#6366f1",
    settings.colorH2 || "#8b5cf6",
    settings.colorH3 || "#06b6d4",
    settings.colorH4 || "#10b981",
    settings.colorH5 || "#f59e0b",
    settings.colorH6 || "#ef4444",
    settings.colorH7 || "#ec4899",
    settings.colorH8 || "#a855f7"
  ];

  // 1. Cor da Raiz
  root.color = baseColors[0];

  if (mode === "single") {
    // Todos os outros nós usam uma única cor (cor H2)
    const singleColor = settings.colorH2 || "#8b5cf6";
    const setSingle = (node: MindNode) => {
      node.color = singleColor;
      for (const child of node.children) {
        setSingle(child);
      }
    };
    for (const child of root.children) {
      setSingle(child);
    }
  } else if (mode === "branch") {
    // Cada ramo direto do nó raiz recebe uma cor diferente
    // E todos os filhos daquele ramo herdam a mesma cor
    root.children.forEach((branchRoot, index) => {
      const branchColor = baseColors[(index % (baseColors.length - 1)) + 1];
      const setBranchColor = (node: MindNode) => {
        node.color = branchColor;
        for (const child of node.children) {
          setBranchColor(child);
        }
      };
      setBranchColor(branchRoot);
    });
  } else {
    // Padrão: por nível (profundidade)
    const setLevelColor = (node: MindNode, level: number) => {
      node.color = baseColors[Math.min(level, baseColors.length - 1)];
      for (const child of node.children) {
        const childLevel = child.level < 0 ? 1 : child.level;
        setLevelColor(child, childLevel);
      }
    };
    root.children.forEach((child) => {
      const childLevel = child.level < 0 ? 1 : child.level;
      setLevelColor(child, childLevel);
    });
  }
}

/**
 * Move um nó da sua posição atual para uma nova posição (antes, depois ou dentro de outro nó).
 * Retorna true se a operação foi bem-sucedida.
 */
export function moveNodeInTree(
  root: MindNode,
  draggedId: string,
  targetId: string,
  position: "before" | "after" | "inside"
): boolean {
  if (draggedId === targetId || draggedId === root.id) return false;
  
  // Não permitir inserir 'before' ou 'after' o nó raiz, pois ele não tem pai
  if (targetId === root.id && (position === "before" || position === "after")) {
    return false;
  }

  // Verifica se o targetId é um descendente do draggedId (evita loop infinito e perda do nó)
  const draggedSubTree = findNodeById(root, draggedId);
  if (draggedSubTree && findNodeById(draggedSubTree, targetId)) {
    return false;
  }

  // 1. Encontra e remove o nó arrastado do seu pai original
  let draggedNode: MindNode | null = null;
  let originalParent: MindNode | null = null;
  let originalIndex: number = -1;

  const removeDragged = (curr: MindNode): boolean => {
    for (let i = 0; i < curr.children.length; i++) {
      if (curr.children[i].id === draggedId) {
        originalParent = curr;
        originalIndex = i;
        draggedNode = curr.children.splice(i, 1)[0];
        return true;
      }
      if (removeDragged(curr.children[i])) return true;
    }
    return false;
  };

  removeDragged(root);
  if (!draggedNode) return false;

  // 2. Insere o nó arrastado na nova posição
  const insertNode = (curr: MindNode): boolean => {
    // Caso de inserção como filho direto (inside)
    if (position === "inside" && curr.id === targetId) {
      curr.children.push(draggedNode!);
      return true;
    }

    // Caso de inserção como irmão (before ou after)
    const idx = curr.children.findIndex(c => c.id === targetId);
    if (idx !== -1) {
      const targetSibling = curr.children[idx];
      if (targetSibling.side) {
        draggedNode!.side = targetSibling.side;
      }
      const insertIdx = position === "before" ? idx : idx + 1;
      curr.children.splice(insertIdx, 0, draggedNode!);
      return true;
    }

    for (const child of curr.children) {
      if (insertNode(child)) return true;
    }
    return false;
  };

  const success = insertNode(root);

  if (success) {
    recalcLevels(root);
  } else {
    // Restaura o nó para sua posição original se a inserção falhar (ex: targetId não encontrado)
    if (originalParent && draggedNode && originalIndex !== -1) {
      (originalParent as MindNode).children.splice(originalIndex, 0, draggedNode);
    }
  }

  return success;
}

/**
 * Recalcula os níveis de todos os nós baseando-se estritamente na profundidade da árvore.
 * Raiz = -1
 * Filhos diretos da raiz = 1
 * Netos da raiz = 2
 * Bisnetos = 3, e assim por diante.
 */
export function recalcLevels(node: MindNode, currentDepth: number = -1): void {
  node.level = currentDepth;
  for (const child of node.children) {
    const childDepth = currentDepth === -1 ? 1 : currentDepth + 1;
    recalcLevels(child, childDepth);
  }
}

