/**
 * Generates the API reference (OpenAPI 3.1) from the source code itself, so it never drifts:
 *   - routes, methods and path parameters come from router.get/post/put/del(...) calls;
 *   - who may call each route comes from requireStaff(ctx, [roles]) / requireMember / requireSuperadmin;
 *   - query parameters come from ctx.query.get("…");
 *   - request bodies come from the real zod schemas passed to ctx.body(...), loaded and converted;
 *   - descriptions come from the comment written just above each route.
 * Usage: tsx scripts/gen-api-docs.ts [outFile]   (default: dist/api-docs.json; run by `npm run build`)
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUMMARIES } from "./api-summaries.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Auth = { kind: "public" | "staff" | "member" | "superadmin"; roles?: string[] };
interface RouteDoc {
  method: string;
  path: string;
  file: string;
  line: number;
  summary: string;
  description: string;
  auth: Auth;
  query: string[];
  paging: boolean;
  bodyExpr?: string;
  bodySchema?: any;
  localDecls?: string[];
  uuidParams: string[];
  queryFormats: Record<string, string>;
}

const METHODS: Record<string, string> = { get: "GET", post: "POST", put: "PUT", del: "DELETE" };
const ROLES_ALL = ["owner", "manager", "reception", "coach"];

function commentAbove(text: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges
    .map((r) => text.slice(r.pos, r.end))
    .map((c) =>
      c.startsWith("//")
        ? c.replace(/^\/\/\s?/, "")
        : c.replace(/^\/\*\*?/, "").replace(/\*\/$/, "").split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).join("\n"),
    )
    .join("\n")
    .trim()
    // section separators like "---- payments ----" are headings, not descriptions
    .replace(/^-{2,}.*-{2,}$/gm, "")
    .trim();
}

function strings(node: ts.Expression | undefined, sf: ts.SourceFile, consts: Map<string, ts.Expression>): string[] | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) && consts.has(node.text)) return strings(consts.get(node.text), sf, consts);
  if (ts.isAsExpression(node)) return strings(node.expression, sf, consts);
  if (ts.isArrayLiteralExpression(node)) return node.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
  return undefined;
}

export function scanFile(file: string): { routes: RouteDoc[]; moduleDoc: string } {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const consts = new Map<string, ts.Expression>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
  }
  const first = sf.statements.find((s) => !ts.isImportDeclaration(s)) ?? sf.statements[0];
  const fileComment = (ts.getLeadingCommentRanges(text, 0) ?? []).map((r) => text.slice(r.pos, r.end)).find((c) => c.startsWith("/**"));
  const moduleDoc = fileComment ? fileComment.replace(/^\/\*\*/, "").replace(/\*\/$/, "").split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).join(" ").replace(/\s+/g, " ").trim() : "";
  void first;

  const routes: RouteDoc[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      /^(router|r)$/.test(node.expression.expression.text) &&
      METHODS[node.expression.name.text] &&
      node.arguments.length === 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.startsWith("/")
    ) {
      const handler = node.arguments[1];
      const r: RouteDoc = {
        method: METHODS[node.expression.name.text],
        path: node.arguments[0].text,
        file: path.relative(root, file).split(path.sep).join("/"),
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        summary: "",
        description: "",
        auth: { kind: "public" },
        query: [],
        paging: false,
        uuidParams: [],
        queryFormats: {},
      };
      const stmt = ts.isExpressionStatement(node.parent) ? node.parent : node;
      const doc = commentAbove(text, stmt);
      if (doc) {
        const [head, ...rest] = doc.split(/\n\s*\n|\n/);
        r.summary = head.trim();
        r.description = rest.join("\n").trim();
      }
      // schemas declared inside register…() (not at module level) are needed to evaluate the body schema
      const locals: string[] = [];
      for (let p: ts.Node | undefined = node.parent; p && p !== sf; p = p.parent) {
        if (!ts.isBlock(p)) continue;
        const own: string[] = [];
        for (const st of p.statements) {
          if (st.getStart() >= node.getStart()) break;
          if (!ts.isVariableStatement(st)) continue;
          const t = st.getText(sf);
          if (/\bz\.|Schema\b/.test(t) && !/\bawait\b|\bctx\b/.test(t)) own.push(t);
        }
        locals.unshift(...own);
      }
      r.localDecls = locals;
      const walk = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression.getText(sf);
          if (callee === "requireStaff") {
            const roles = strings(n.arguments[1], sf, consts);
            if (r.auth.kind === "public") r.auth = { kind: "staff", roles: roles ?? ROLES_ALL };
          } else if (callee === "requireMember") {
            if (r.auth.kind === "public") r.auth = { kind: "member" };
          } else if (callee === "requireSuperadmin") {
            r.auth = { kind: "superadmin" };
          } else if (callee === "ctx.body" && n.arguments[0] && !r.bodyExpr) {
            r.bodyExpr = n.arguments[0].getText(sf);
          } else if (/^ctx\.query\.(get|getAll|has)$/.test(callee) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
            if (!r.query.includes(n.arguments[0].text)) r.query.push(n.arguments[0].text);
          } else if (callee === "zId.parse" && n.arguments[0] && /^ctx\.params\.\w+$/.test(n.arguments[0].getText(sf))) {
            r.uuidParams.push(n.arguments[0].getText(sf).split(".")[2]);
          } else if (/^(zDate|zId)\.parse$/.test(callee) && n.arguments[0]) {
            for (const m of n.arguments[0].getText(sf).matchAll(/ctx\.query\.get\("([^"]+)"\)/g)) r.queryFormats[m[1]] = callee === "zDate.parse" ? "date" : "uuid";
          } else if (callee === "pageParams") {
            r.paging = true;
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(handler);
      routes.push(r);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { routes, moduleDoc };
}

/** Loads the zod schemas used in ctx.body(...) by evaluating each expression inside a copy of its module. */
async function loadSchemas(file: string, routes: RouteDoc[]) {
  const withBody = routes.filter((r) => r.bodyExpr);
  if (!withBody.length) return;
  const copy = path.join(path.dirname(file), `.apidoc-${path.basename(file)}`);
  const src = fs.readFileSync(file, "utf8");
  const getters = withBody.map((r, i) => `  "${i}": () => {\n${(r.localDecls ?? []).join("\n")}\nreturn (${r.bodyExpr});\n},`).join("\n");
  fs.writeFileSync(copy, `${src}\n;export const __apidoc: Record<string, () => any> = {\n${getters}\n};\n`);
  try {
    const mod = await import(pathToFileURL(copy).href);
    withBody.forEach((r, i) => {
      try {
        r.bodySchema = zodToJson(mod.__apidoc[String(i)]());
      } catch {
        r.bodySchema = { description: `Validated by: ${r.bodyExpr}` };
      }
    });
  } finally {
    fs.rmSync(copy, { force: true });
  }
}

// ---------- zod (v3) → JSON Schema ----------
export function zodToJson(s: any): any {
  const def = s?._def;
  if (!def) return {};
  const t: string = def.typeName;
  const withDesc = (o: any) => (def.description ? { ...o, description: def.description } : o);
  switch (t) {
    case "ZodString": {
      const o: any = { type: "string" };
      for (const c of def.checks ?? []) {
        if (c.kind === "min") o.minLength = c.value;
        else if (c.kind === "max") o.maxLength = c.value;
        else if (c.kind === "length") o.minLength = o.maxLength = c.value;
        else if (c.kind === "email") o.format = "email";
        else if (c.kind === "url") o.format = "uri";
        else if (c.kind === "uuid") o.format = "uuid";
        else if (c.kind === "datetime") o.format = "date-time";
        else if (c.kind === "regex") {
          if (String(c.regex) === String(/^\d{4}-\d{2}-\d{2}$/)) o.format = "date";
          else o.pattern = c.regex.source;
        }
      }
      return withDesc(o);
    }
    case "ZodNumber": {
      const o: any = { type: "number" };
      for (const c of def.checks ?? []) {
        if (c.kind === "int") o.type = "integer";
        else if (c.kind === "min") o[c.inclusive ? "minimum" : "exclusiveMinimum"] = c.value;
        else if (c.kind === "max") o[c.inclusive ? "maximum" : "exclusiveMaximum"] = c.value;
      }
      if (def.coerce) o["x-coerce"] = true;
      return withDesc(o);
    }
    case "ZodBigInt": return { type: "integer" };
    case "ZodBoolean": return withDesc({ type: "boolean" });
    case "ZodDate": return withDesc({ type: "string", format: "date-time" });
    case "ZodLiteral": return withDesc({ const: def.value });
    case "ZodEnum": return withDesc({ type: "string", enum: [...def.values] });
    case "ZodNativeEnum": return withDesc({ enum: Object.values(def.values) });
    case "ZodNull": return { type: "null" };
    case "ZodAny":
    case "ZodUnknown": return withDesc({});
    case "ZodArray": {
      const o: any = { type: "array", items: zodToJson(def.type) };
      if (def.minLength) o.minItems = def.minLength.value;
      if (def.maxLength) o.maxItems = def.maxLength.value;
      if (def.exactLength) o.minItems = o.maxItems = def.exactLength.value;
      return withDesc(o);
    }
    case "ZodTuple": return { type: "array", prefixItems: def.items.map(zodToJson) };
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries<any>(shape)) {
        properties[k] = zodToJson(v);
        if (!v.isOptional()) required.push(k);
      }
      const o: any = { type: "object", properties };
      if (required.length) o.required = required;
      if (def.catchall && def.catchall._def.typeName !== "ZodNever") o.additionalProperties = zodToJson(def.catchall);
      return withDesc(o);
    }
    case "ZodRecord": return withDesc({ type: "object", additionalProperties: zodToJson(def.valueType) });
    case "ZodMap": return { type: "object" };
    case "ZodOptional": return zodToJson(def.innerType);
    case "ZodNullable": {
      const inner = zodToJson(def.innerType);
      if (typeof inner.type === "string") return { ...inner, type: [inner.type, "null"] };
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodDefault": {
      let d: unknown;
      try { d = def.defaultValue(); } catch { /* dynamic default */ }
      return { ...zodToJson(def.innerType), ...(d !== undefined ? { default: d } : {}) };
    }
    case "ZodCatch":
    case "ZodBranded":
    case "ZodReadonly": return zodToJson(def.innerType ?? def.type);
    case "ZodEffects": return withDesc(zodToJson(def.schema));
    case "ZodPipeline": return zodToJson(def.in);
    case "ZodLazy": return zodToJson(def.getter());
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const opts = [...(def.options instanceof Map ? def.options.values() : def.options)].map(zodToJson);
      // "x or empty string → null" is just a convenience for forms: document the useful branch
      const useful = opts.filter((o: any) => !(o.const === ""));
      return useful.length === 1 ? useful[0] : { anyOf: useful };
    }
    case "ZodIntersection": return { allOf: [zodToJson(def.left), zodToJson(def.right)] };
    default: return {};
  }
}

// ---------- OpenAPI ----------
const TAGS: Record<string, string> = {
  "server/index.ts": "System",
  "server/modules/gym.ts": "Gym, team & settings",
  "server/modules/members.ts": "Members, memberships & payments",
  "server/modules/classes.ts": "Classes & personal training",
  "server/modules/business.ts": "Dashboard, finance & reports",
  "server/modules/engage.ts": "Messages, leads & notifications",
  "server/modules/portal.ts": "Member app & public pages",
  "server/modules/admin.ts": "Platform admin",
  "server/modules/shop.ts": "Shop",
  "server/modules/kpis.ts": "Dashboard, finance & reports",
  "server/modules/ptbook.ts": "Classes & personal training",
  "server/modules/community.ts": "Member engagement: offers, challenges, referrals",
};

/** Routes that answer with something other than JSON. */
const RESPONSE_TYPES: Record<string, any> = {
  "GET /api/members/export.csv": { description: "CSV file (UTF-8 with BOM, opens in Excel)", content: { "text/csv": {} } },
  "GET /r/{token}": { description: "HTML receipt page", content: { "text/html": {} } },
  "GET /api/public/gyms/{slug}/logo": { description: "Logo image", content: { "image/png": {}, "image/jpeg": {}, "image/webp": {} } },
  "GET /m/{slug}/manifest.webmanifest": { description: "Web app manifest", content: { "application/manifest+json": {} } },
  "GET /api/webhooks/whatsapp": { description: "Echoes `hub.challenge` as plain text", content: { "text/plain": {} } },
  "GET /api/reports/finance/report.xlsx": { description: "Excel workbook", content: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {} } },
  "GET /api/public/offers/{id}/image": { description: "Image", content: { "image/png": {}, "image/jpeg": {}, "image/webp": {} } },
  "GET /api/public/products/{id}/image": { description: "Image", content: { "image/png": {}, "image/jpeg": {}, "image/webp": {} } },
};

function authText(a: Auth): string {
  if (a.kind === "public") return "Public: no sign-in needed.";
  if (a.kind === "member") return "Member app session (cookie `gms_member`).";
  if (a.kind === "superadmin") return "GMS platform admin only.";
  const roles = a.roles ?? ROLES_ALL;
  return `Staff session (cookie \`gms_staff\`). Roles: ${roles.join(", ")} (platform admins always allowed).`;
}

export async function generate() {
  // modules are only loaded to read their schemas: no database, no production checks at build time
  if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "development";
  process.env.DATABASE_URL ??= "postgres://build@127.0.0.1:1/none";
  process.env.JOBS_ENABLED = "false";
  const files = [path.join(root, "server/index.ts"), ...fs.readdirSync(path.join(root, "server/modules")).filter((f) => f.endsWith(".ts") && !f.startsWith(".")).sort().map((f) => path.join(root, "server/modules", f))];
  const all: RouteDoc[] = [];
  const tags: { name: string; description: string }[] = [];
  for (const f of files) {
    const { routes, moduleDoc } = scanFile(f);
    if (!routes.length) continue;
    await loadSchemas(f, routes);
    const rel = path.relative(root, f).split(path.sep).join("/");
    const tagName = TAGS[rel] ?? path.basename(f, ".ts");
    // several files can share a section: keep one entry (the first file's description)
    if (!tags.some((t) => t.name === tagName)) tags.push({ name: tagName, description: moduleDoc });
    all.push(...routes);
  }

  const paths: Record<string, any> = {};
  for (const r of all) {
    const p = r.path.replace(/:([A-Za-z_]+)/g, "{$1}");
    const parameters: any[] = [];
    for (const m of r.path.matchAll(/:([A-Za-z_]+)/g)) parameters.push({ name: m[1], in: "path", required: true, schema: r.uuidParams.includes(m[1]) ? { type: "string", format: "uuid" } : { type: "string" } });
    for (const q of r.query) parameters.push({ name: q, in: "query", required: false, schema: r.queryFormats[q] ? { type: "string", format: r.queryFormats[q] } : { type: "string" } });
    if (r.paging) parameters.push({ name: "limit", in: "query", schema: { type: "integer" } }, { name: "offset", in: "query", schema: { type: "integer" } });
    if (r.auth.kind === "staff") parameters.push({ name: "X-Gym-Id", in: "header", required: false, description: "Platform admins only: the gym to act on.", schema: { type: "string", format: "uuid" } });
    const tag = TAGS[r.file] ?? path.basename(r.file, ".ts");
    const entry = SUMMARIES[`${r.method} ${p}`];
    const [summary, notes] = Array.isArray(entry) ? entry : [entry, ""];
    // the comment above the route in the code adds detail when it says more than the summary
    const codeNote = [r.summary, r.description].filter(Boolean).join(" ").trim();
    const op: any = {
      tags: [tag],
      summary: summary || r.summary || `${r.method} ${r.path}`,
      description: [notes || (codeNote.length > 30 && codeNote !== summary ? codeNote : ""), authText(r.auth)].filter(Boolean).join("\n\n"),
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[:/{}-]+(\w)?/g, (_, c) => (c ? c.toUpperCase() : ""))}`,
      parameters,
      security: r.auth.kind === "public" ? [] : [{ [r.auth.kind === "member" ? "memberSession" : "staffSession"]: [] }],
      "x-auth": r.auth,
      "x-source": `${r.file}:${r.line}`,
      responses: {
        "200": RESPONSE_TYPES[`${r.method} ${p}`] ?? { description: "OK", content: { "application/json": {} } },
        ...(r.bodyExpr ? { "400": { description: "Validation error: `{ error, message }`" } } : {}),
        ...(r.auth.kind !== "public" ? { "401": { description: "Not signed in" }, "403": { description: "Role not allowed" } } : {}),
      },
    };
    if (r.bodyExpr) op.requestBody = { required: true, content: { "application/json": { schema: r.bodySchema ?? {} } } };
    (paths[p] ??= {})[r.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "GMS API",
      version: process.env.APP_VERSION ?? "dev",
      description:
        "Calls are JSON over HTTPS on the same domain as the app. Staff sign in with `POST /api/auth/login` (cookie `gms_staff`); " +
        "members sign in from the member app (cookie `gms_member`). Write calls (POST/PUT/DELETE) must send `Content-Type: application/json` " +
        "and come from the app's own origin. Errors look like `{ \"error\": \"code\", \"message\": \"…\" }`.",
    },
    servers: [{ url: "/" }],
    tags,
    paths,
    components: {
      securitySchemes: {
        staffSession: { type: "apiKey", in: "cookie", name: "gms_staff" },
        memberSession: { type: "apiKey", in: "cookie", name: "gms_member" },
      },
    },
  };
}

const isMain = !!process.argv[1] && /gen-api-docs\.ts$/.test(process.argv[1]);
if (isMain) {
  const out = path.resolve(root, process.argv[2] ?? "dist/api-docs.json");
  const spec = await generate();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(spec));
  const n = Object.values(spec.paths).reduce((s: number, p: any) => s + Object.keys(p).length, 0);
  console.log(`[api-docs] ${n} routes → ${path.relative(root, out)}`);
  process.exit(0);
}
