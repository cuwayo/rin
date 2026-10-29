---

name: google-markdown-style
description: "Create or review Google-style Markdown documentation."
---

# Google Markdown Style

Use the [Google Markdown style guide](https://google.github.io/styleguide/docguide/style.html)
as the canonical source. The sections below follow every section in that guide.
Apply them when the repository and target renderer support them; repository-specific
rules take precedence.

## Minimum viable documentation

Keep documentation small, accurate, and purposeful. Identify the documentation users
actually need, and remove obsolete material in small, frequent updates.

## Better is better than best

Make useful incremental improvements. During review, offer concrete alternatives and
avoid blocking a change for polish that can safely follow. Reserve a block for a
change that materially worsens the documentation.

## Capitalization

Use the original capitalization for product, tool, and binary names.

## Document layout

For a standalone page, use this order:

1. One H1 title, normally matching the filename.
2. An optional author line when ownership needs to be explicit.
3. A one-to-three-sentence introduction for readers new to the subject.
4. `[TOC]`, when supported and appropriate.
5. H2-and-deeper topic sections.
6. An optional `See also` section for miscellaneous links.

## Table of contents

Use `[TOC]` for content extending below the fold only when the documentation host
supports it. Place it after the introduction and before the first H2 so its position
is accessible to screen-reader and keyboard users. Do not add renderer-specific
directives to portable Markdown.

## Character line limit

Wrap ordinary prose at 80 characters. Do not force-wrap headings, links, tables, or
code blocks. Wrap surrounding prose around a long link instead.

## Trailing whitespace

Never use trailing whitespace. Prefer separate paragraphs to forced line breaks; use
one trailing backslash sparingly when a line break is truly required.

## Headings

Use ATX-style headings (`#`, `##`) rather than underline-style headings. Use one H1
as the page title, then H2 or deeper for all following structure. Make each heading
unique and fully descriptive so anchors remain clear. Add a space after `#` and blank
lines before and after headings. Follow the applicable Google capitalization guidance.

## Lists

For long or frequently edited ordered lists, use lazy numbering (`1.` for every
item). Keep short, stable ordered lists explicitly numbered. For nested or multi-line
lists, indent list text and continuations to four spaces: two spaces after an ordered
marker and three after a bullet. A short, flat, single-line list may use one space.

## Code

Use backticks for inline code, commands, identifiers, generic file types, literal
paths, and text that Markdown must not parse. Use fenced code blocks rather than
indented blocks, and declare a language whenever it is known. Escape continuation
lines in copyable command-line examples with a final backslash. Indent a code block
within a list enough to keep it part of that list item.

## Links

Use readable, informative link text rather than `here`, `link`, or a bare URL as its
label. For Markdown files in another directory, use an explicit root-relative path;
same-directory relative paths are acceptable. Avoid `../` paths. Use reference links
when an inline URL harms readability, the destination repeats, or a table cell needs
to stay compact. Define a local reference after its first-use section; put references
used in multiple sections at the end of the document.

## Images

Use images sparingly and only when showing something communicates more clearly than
text. Prefer simple screenshots and provide text alternatives that convey the
necessary meaning to readers who cannot see the image.

## Tables

Use tables for compact, parallel, two-dimensional data that readers need to scan.
Prefer lists and headings for sparse information, uneven rows, or prose-heavy cells.
Use reference links when they keep table cells readable.

## Strongly prefer Markdown to HTML

Use standard Markdown in preference to embedded HTML. Reconsider a layout requirement
that needs an HTML workaround, except where the Markdown renderer and repository
explicitly support the necessary exception.

## Review

Check rendered output where feasible, especially nested lists, code blocks, links,
tables, and image alternatives. Suggest concrete improvements while following the
Better/Best Rule above.
