# Mark My Mind 🧠

**Plugin Obsidian** — transforma Markdown em **Mapa Mental interativo** com sincronização em tempo real entre os dois.

---

## 📦 Instalação

| Método | Passos |
|--------|--------|
| **BRAT** (recomendado) | Instale o [BRAT](https://obsidian.md/plugins?id=BRAT) → repo `https://github.com/mark-my-mind/mark-my-mind` → ative nas Configurações |
| **Manual** | Copie `main.js` + `manifest.json` + `styles.css` para `SEU_VAULT/.obsidian/plugins/mark-my-mind/` → ative |

---

## 🧠 Abrir / Criar

| Ação | Jeitos de fazer |
|------|----------------|
| **Abrir `.md` como mapa** | Ícone 🧠 na ribbon (barra lateral)<br>Botão direito no arquivo > "Abrir como Mark My Mind"<br>Botão 🧠 na barra de ações do editor<br>Paleta de comandos `Ctrl+P` > "Open as Mark My Mind" |
| **Criar novo mapa** | Ícone 🧠 na ribbon (sem arquivo aberto)<br>Botão direito numa pasta > "Criar novo Mapa Mental"<br>Paleta de comandos > "Create new mind map" |

---

## 🖥️ Interface

### 🔝 Toolbar (topo)
| Botão/Grupo | O que faz |
|-------------|-----------|
| ↩️ **Editor** | Volta pro editor de texto |
| 🎯 **Foco** | Alterna centralização automática no nó selecionado |
| 🔄 **Reset** | Reseta zoom e posição do canvas |
| ⊞ **Fit View** | Enquadra todos os nós na tela |
| 📊 **Nível (1-6)** | Expande/colapsa a árvore até o nível escolhido |
| 🧩 **Layout** | Muda entre → Direita, ↓ Baixo, ↔ Bidirecional, ↑ Cima |
| 📐 **Line Form** | Escolhe estilo da linha: Curva, Arredondada, Reta |
| 📏 **Line Size** | Espessura das linhas (1-10px) |
| 🔤 **Block Settings** | Tamanho da fonte, largura e altura máxima dos blocos |
| 🎨 **Colors** | Modo de cor (nível / ramo / fixa) + cores personalizadas |
| 👁️ **Ver Só Títulos** | Oculta notas, mostra só os títulos |
| 🌳 **Múltiplos Blocos** | Alterna entre raiz única ou vários H1s independentes |
| ☕ **Apoiar** | Apoie o projeto ❤️ |

### 📋 Sidebar (painel direito)
| Seção | Opções |
|-------|--------|
| **Layout Colors** | Layout (4 direções) + Modo de cor (nível/ramo/fixo) |
| **Line Form** | Estilo da linha (curva/arredondada/reta) + Espessura |
| **Block Settings** | Tamanho da fonte, Largura do bloco, Altura máxima |

### 🖱️ Canvas
- **Scroll** → zoom
- **Arrastar fundo** → pan (move a tela)
- **Arrastar bloco** → move o nó + filhos junto
- **Duplo clique no bloco** → edita título e nota inline
- **Hover no bloco** → botões `+` (adicionar filho), `−` (colapsar), `×` (deletar)

---

## ⌨️ Atalhos

| Tecla | Ação |
|-------|------|
| `+` / `=` | ➕ Adicionar nó filho |
| `-` / `_` | ➖ Colapsar / Expandir nó |
| `Delete` / `Backspace` | 🗑️ Remover nó |
| `← ↑ ↓ →` | 🧭 Navegar entre nós |
| `1` a `6` | 📊 Expandir/colapsar até nível N |
| `Ctrl+Z` / `Ctrl+Y` | ↩️ Desfazer / Refazer |
| `Ctrl+Enter` | 💾 Salvar edição inline |

---

## ⚙️ Configurações

Em **Configurações > Mark My Mind** você ajusta: layout padrão, estilo das linhas, velocidade de sincronização, auto-abrir, mostrar notas, altura máxima dos blocos, tamanho da fonte, largura, cores e mais.

---

## 📝 YAML Frontmatter

```yaml
---
mmm-type: mindmap
mmm-layout: ">"
mmm-notename: "Meu Mapa"
---
```

| Chave | O que faz |
|-------|-----------|
| `mmm-type: mindmap` | 🏷️ Marca o arquivo como mapa mental (abre direto no canvas) |
| `mmm-layout` | `">"` → direita, `"<>"` → bidirecional, `"V"` → baixo, `"A"` → cima |
| `mmm-notename` | ✏️ Nome personalizado da raiz visual |

>

---

## 🛠️ Build (devs)

```bash
npm install
npm run build     # compila main.js
npm run dev       # modo watch
```

---

## 🌐 Traduções

🇧🇷 🇺🇸 🇪🇸 🇩🇪 🇫🇷 🇯🇵 🇨🇳

Arquivos em `src/locales/`. Para adicionar idioma: crie `xx.json`, importe em `src/i18n.ts`, rode `npm run build`.

---

## ❤️ Apoie

Se o plugin te ajudou, clique em **☕ Apoiar** na toolbar. Isso me incentiva a continuar com esse projeto maravilhoso ✨

---

## 📄 Licença

MIT
