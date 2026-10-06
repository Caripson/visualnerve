export class StorageError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
