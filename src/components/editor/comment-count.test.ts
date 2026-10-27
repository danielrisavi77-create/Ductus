import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { commentsTabText, CommentsTabLabel, publishCommentCount } from "./comment-count";

describe("comments tab label (Archivum S04)", () => {
  it("says Komentari without a loaded list or an open comment, and Komentari (n) with n open", () => {
    expect(commentsTabText(null)).toBe("Komentari");
    expect(commentsTabText(0)).toBe("Komentari");
    expect(commentsTabText(3)).toBe("Komentari (3)");
  });

  it("renders no number on the server, before the panel has loaded anything", () => {
    publishCommentCount("izmisljeni-dokument-a", 2);
    expect(renderToStaticMarkup(h(CommentsTabLabel, { documentId: "izmisljeni-dokument-a" }))).toBe("Komentari");
    publishCommentCount("izmisljeni-dokument-a", null);
  });
});
