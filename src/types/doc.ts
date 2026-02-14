/** Generic document envelope with docId, docType, and data payload. */
export type Doc<T extends string, D> = {
  docId: string;
  docType: T;
  data: D;
};
