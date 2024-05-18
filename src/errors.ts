export class ParsingError extends Error {
  name = 'ParsingError'

  constructor(
    message: string,
    public hint?: string
  ) {
    super(sentenceCase(message))
  }
}

export class UnimplementedError extends Error {
  name = 'UnimplementedError'
}

export class UnsupportedError extends Error {
  name = 'UnsupportedError'

  constructor(
    message: string,
    public hint?: string
  ) {
    super(message)
  }
}

export class RenderError extends Error {
  name = 'RenderError'

  constructor(
    message: string,
    public renderer: 'http' | 'supabase-js'
  ) {
    super(message)
  }
}

export function sentenceCase(value: string) {
  return value[0].toUpperCase() + value.slice(1)
}

/**
 * Returns hints for common parsing errors.
 */
export function getParsingErrorHint(message: string) {
  switch (message) {
    case 'syntax error at or near "from"':
      return 'Did you leave a trailing comma in the select target list?'
    case 'syntax error at or near "where"':
      return 'Do you have an incomplete join in the FROM clause?'
    default:
      undefined
  }
}
