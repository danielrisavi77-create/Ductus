export type Person = {
  kind: "person";
  family: string;
  given: string;
};

export type Organization = {
  kind: "organization";
  name: string;
  acronym?: string;
};

export type Author = Person | Organization;

type SourceBase = {
  authors: readonly Author[];
  year: number;
  /** "a", "b", ... when one author has several works in the same year. */
  yearSuffix?: string;
  title: string;
};

export type BookSource = SourceBase & {
  type: "book";
  place: string;
  publisher: string;
};

export type ArticleSource = SourceBase & {
  type: "article";
  journal: string;
  volume?: string;
  issue?: string;
  pages?: string;
};

export type ChapterSource = SourceBase & {
  type: "chapter";
  editors: readonly Person[];
  bookTitle: string;
  place: string;
  publisher: string;
  pages?: string;
};

export type WebSource = SourceBase & {
  type: "web";
  url: string;
  /** Access date as ISO `YYYY-MM-DD`; required by the FPZG style. */
  accessed: string;
};

export type Source = BookSource | ArticleSource | ChapterSource | WebSource;

export class CitationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CitationInputError";
  }
}
