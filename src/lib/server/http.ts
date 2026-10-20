import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Runs a route handler body and turns thrown errors into JSON responses. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    return data instanceof Response ? data : Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof ZodError) return Response.json({ error: 'That request was not valid.' }, { status: 400 });
    console.error(err);
    return Response.json({ error: 'Something went wrong on the server. Try again.' }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'That request was not valid.');
  }
}
