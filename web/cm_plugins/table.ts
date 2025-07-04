import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";
import { type ParseTree, renderToText } from "../../plug-api/lib/tree.ts";
import { lezerToParseTree } from "../markdown_parser/parse_tree.ts";
import type { Client } from "../client.ts";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { expandMarkdown } from "../markdown.ts";
import { LuaStackFrame } from "../../lib/space_lua/runtime.ts";

class TableViewWidget extends WidgetType {
  tableBodyText: string;

  constructor(
    readonly pos: number,
    readonly client: Client,
    readonly t: ParseTree,
  ) {
    super();
    this.tableBodyText = renderToText(t);
  }

  override get estimatedHeight(): number {
    return this.client.getCachedWidgetHeight(
      `table:${this.tableBodyText}`,
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.classList.add("sb-table-widget");
    dom.addEventListener("click", (e) => {
      // Pulling data-pos to put the cursor in the right place, falling back
      // to the start of the table.
      const dataAttributes = (e.target as any).dataset;
      this.client.editorView.dispatch({
        selection: {
          anchor: dataAttributes.pos ? +dataAttributes.pos : this.pos,
        },
      });
    });

    const sf = LuaStackFrame.createWithGlobalEnv(
      client.clientSystem.spaceLuaEnv.env,
    );
    expandMarkdown(
      client,
      this.t,
      client.clientSystem.spaceLuaEnv.env,
      sf,
    ).then((t) => {
      dom.innerHTML = renderMarkdownToHtml(t, {
        // Annotate every element with its position so we can use it to put
        // the cursor there when the user clicks on the table.
        annotationPositions: true,
        translateUrls: (url) => {
          if (isLocalPath(url)) {
            url = resolvePath(this.client.currentPage, decodeURI(url));
          }

          return url;
        },
        preserveAttributes: true,
      });
      setTimeout(() => {
        // Give it a tick to render
        this.client.setCachedWidgetHeight(
          `table:${this.tableBodyText}`,
          dom.clientHeight,
        );
      });
    });
    return dom;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof TableViewWidget &&
      other.tableBodyText === this.tableBodyText
    );
  }
}

export function tablePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        const { from, to, name } = node;
        if (name !== "Table") return;
        if (isCursorInRange(state, [from, to])) return;

        const tableText = state.sliceDoc(from, to);
        const lineStrings = tableText.split("\n");

        const lines: { from: number; to: number }[] = [];
        let fromIt = from;
        for (const line of lineStrings) {
          lines.push({
            from: fromIt,
            to: fromIt + line.length,
          });
          fromIt += line.length + 1;
        }

        const firstLine = lines[0], lastLine = lines[lines.length - 1];

        // In case of doubt, back out
        if (!firstLine || !lastLine) return;

        widgets.push(invisibleDecoration.range(firstLine.from, firstLine.to));
        widgets.push(invisibleDecoration.range(lastLine.from, lastLine.to));

        lines.slice(1, lines.length - 1).forEach((line) => {
          widgets.push(
            Decoration.line({ class: "sb-line-table-outside" }).range(
              line.from,
            ),
          );
        });
        const text = state.sliceDoc(0, to);
        widgets.push(
          Decoration.widget({
            widget: new TableViewWidget(
              from,
              editor,
              lezerToParseTree(text, node.node),
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
