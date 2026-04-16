type UnknownObject = Record<string, unknown>;

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null;
}

function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isGoogleSheetsAddSheetAlreadyExistsError(error: unknown): boolean {
  if (!isObject(error)) {
    return false;
  }

  const response = isObject(error.response) ? error.response : null;
  const status = typeof response?.status === 'number' ? response.status : null;
  if (status !== 400) {
    return false;
  }

  const message = typeof error.message === 'string' ? error.message : '';
  const source = `${toText(response?.data)} ${message}`.toLowerCase();

  const hasAddSheetMarker =
    source.includes('addsheet') || source.includes('add sheet') || source.includes('add_sheet');

  if (!hasAddSheetMarker) {
    return false;
  }

  return /already exists|already exist|уже существует|вже існує/i.test(source);
}
