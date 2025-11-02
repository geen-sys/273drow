import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./api/routes.js";
import * as dotenv from "dotenv";

dotenv.config();

let appPromise: Promise<FastifyInstance> | undefined;

const getOrigins = (): string[] => {
  const fallbackOrigins = [
    "http://localhost:5173",
    "http://localhost:4173",
    "https://d21iyt3tejfu9r.cloudfront.net",
  ];
  const configured = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured && configured.length > 0 ? configured : fallbackOrigins;
};

export const buildApp = async (): Promise<FastifyInstance> => {
  if (!appPromise) {
    appPromise = (async () => {
      const app = Fastify({ logger: true });

      await app.register(cors, {
        origin: getOrigins(),
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        maxAge: 86400,
      });

      registerRoutes(app);

      return app;
    })();
  }

  return appPromise;
};

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8787);

  app.listen({ host: "0.0.0.0", port }).then(() => {
    console.log(`Server listening at http://0.0.0.0:${port}`);
  });
}

type ApiGatewayV1Event = {
  version?: string | null;
  httpMethod?: string | null;
  path?: string | null;
  headers?: Record<string, string | undefined> | undefined;
  multiValueQueryStringParameters?: Record<string, (string | null)[] | undefined> | undefined;
  queryStringParameters?: Record<string, string | undefined> | undefined;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type ApiGatewayV2Event = {
  version?: string | null;
  rawPath?: string | null;
  rawQueryString?: string | null;
  headers?: Record<string, string | undefined> | undefined;
  requestContext?: {
    http?: {
      method?: string | null;
    } | null;
  } | null;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type LambdaEvent = ApiGatewayV1Event | ApiGatewayV2Event;

type LambdaResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
  multiValueHeaders?: Record<string, string[]>;
  cookies?: string[];
};

const isHttpApiEvent = (event: LambdaEvent): event is ApiGatewayV2Event =>
  (event as ApiGatewayV2Event).version === "2.0" &&
  !!(event as ApiGatewayV2Event).requestContext?.http;

const getMethod = (event: LambdaEvent): string => {
  if (isHttpApiEvent(event)) {
    return event.requestContext.http.method ?? "GET";
  }

  return event.httpMethod ?? "GET";
};

const getPath = (event: LambdaEvent): string => {
  if (isHttpApiEvent(event)) {
    return event.rawPath ?? "/";
  }

  return event.path ?? "/";
};

const getQueryString = (event: LambdaEvent): string => {
  if (isHttpApiEvent(event)) {
    return event.rawQueryString ?? "";
  }

  const params = event.multiValueQueryStringParameters ?? {};
  const searchParams = new URLSearchParams();

  if (Object.keys(params).length > 0) {
    for (const [key, values] of Object.entries(params)) {
      if (Array.isArray(values)) {
        for (const value of values) {
          if (value != null) {
            searchParams.append(key, value);
          }
        }
      }
    }
  } else if (event.queryStringParameters) {
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      if (value != null) {
        searchParams.append(key, value);
      }
    }
  }

  return searchParams.toString();
};

const getPayload = (event: LambdaEvent): Buffer | string | undefined => {
  if (!event.body) {
    return undefined;
  }

  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64");
  }

  return event.body;
};

const normalizeHeaders = (
  headers: Record<string, string | string[] | undefined>,
): {
  single: Record<string, string>;
  multi: Record<string, string[]>;
} => {
  const single: Record<string, string> = {};
  const multi: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        multi[key] = value;
      }
    } else {
      single[key] = value;
    }
  }

  return { single, multi };
};

const toResult = (
  statusCode: number,
  headers: {
    single: Record<string, string>;
    multi: Record<string, string[]>;
  },
  body: string,
  isBase64Encoded: boolean,
  useHttpApi: boolean,
): LambdaResult => {
  if (useHttpApi) {
    const cookiesEntry = Object.entries(headers.multi).find(
      ([key]) => key.toLowerCase() === "set-cookie",
    );
    const cookies = cookiesEntry?.[1]?.length ? cookiesEntry[1] : undefined;

    return {
      statusCode,
      headers: headers.single,
      body,
      isBase64Encoded,
      ...(cookies ? { cookies } : {}),
    } satisfies LambdaResult;
  }

  return {
    statusCode,
    headers: headers.single,
    multiValueHeaders: headers.multi,
    body,
    isBase64Encoded,
  } satisfies LambdaResult;
};

export const handler = async (event: LambdaEvent) => {
  const app = await buildApp();
  await app.ready();

  const method = getMethod(event);
  const path = getPath(event);
  const queryString = getQueryString(event);
  const url = queryString ? `${path}?${queryString}` : path;
  const payload = getPayload(event);

  const response = await app.inject({
    method,
    url,
    headers: event.headers ?? {},
    payload,
  });

  const rawPayload = (response as unknown as { rawPayload?: Buffer }).rawPayload;
  const isBase64Encoded = Buffer.isBuffer(rawPayload);
  const body = isBase64Encoded
    ? (rawPayload as Buffer).toString("base64")
    : response.body ?? "";

  const headers = normalizeHeaders(response.headers);

  return toResult(
    response.statusCode,
    headers,
    body,
    isBase64Encoded,
    isHttpApiEvent(event),
  );
};
