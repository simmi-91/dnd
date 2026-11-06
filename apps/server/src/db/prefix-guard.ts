import { sql } from 'kysely';
import type {
  KyselyPlugin,
  OperationNode,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RawBuilder,
  RootOperationNode,
  UnknownRow,
} from 'kysely';

export const TABLE_PREFIX = 'dd_';

export class TablePrefixError extends Error {
  override name = 'TablePrefixError';
  constructor(public readonly detail: string) {
    super(
      `Migreringen ble nektet: ${detail}. Migreringer kan bare endre tabeller med prefikset ${TABLE_PREFIX}.`,
    );
  }
}

/**
 * Den eneste rå SQL-en migreringene får bruke. Teksten må være nøyaktig lik, uten
 * parametre eller identifikatorer. Trengs mer, legg det til her.
 */
const RAW_ALLOWLIST = {
  currentTimestamp: 'CURRENT_TIMESTAMP',
  onUpdateCurrentTimestamp: 'ON UPDATE CURRENT_TIMESTAMP',
  tinyint1: 'TINYINT(1)',
  mediumtext: 'MEDIUMTEXT',
  tableOptions: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
} as const;

const ALLOWED_RAW = new Set<string>(Object.values(RAW_ALLOWLIST));

/** Faste SQL-biter til kolonnedefinisjoner og tabellvalg i migreringer. */
export const ddl = Object.freeze(
  Object.fromEntries(Object.entries(RAW_ALLOWLIST).map(([key, text]) => [key, sql.raw(text)])) as {
    [K in keyof typeof RAW_ALLOWLIST]: RawBuilder<unknown>;
  },
);

/** Spørringstypene migreringene kan kjøre. Alt annet (rå SQL, DML, views osv.) nektes. */
const ALLOWED_ROOTS = new Set([
  'CreateTableNode',
  'AlterTableNode',
  'DropTableNode',
  'CreateIndexNode',
  'DropIndexNode',
]);

function isOperationNode(value: unknown): value is OperationNode {
  return (
    typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string'
  );
}

function checkTable(node: OperationNode): void {
  const table = (node as unknown as { table: { schema?: { name: string }; identifier: { name: string } } })
    .table;
  const name = table.identifier.name;
  // Tabeller i andre skjemaer (databaser) er aldri lov, heller ikke med dd_.
  if (table.schema)
    throw new TablePrefixError(`tabellen «${table.schema.name}.${name}» ligger i en annen database`);
  if (!name.startsWith(TABLE_PREFIX)) throw new TablePrefixError(`tabellen «${name}» mangler prefikset`);
}

function checkRaw(node: OperationNode): void {
  const { sqlFragments, parameters } = node as unknown as {
    sqlFragments: readonly string[];
    parameters: readonly unknown[];
  };
  const text = sqlFragments.length === 1 ? sqlFragments[0] : undefined;
  if (parameters.length > 0 || text === undefined || !ALLOWED_RAW.has(text)) {
    throw new TablePrefixError('rå SQL er ikke tillatt (bruk query builderen eller ddl-hjelperne)');
  }
}

/** Går gjennom hele nodetreet. Alle tabellnoder sjekkes, og rå SQL må stå på tillatelseslisten. */
function walk(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (!isOperationNode(value)) return;
  if (value.kind === 'TableNode') return checkTable(value);
  if (value.kind === 'RawNode') return checkRaw(value);
  // `setSchema` flytter tabellen til en annen database, og målet er ikke en TableNode.
  if (value.kind === 'AlterTableNode' && (value as { setSchema?: unknown }).setSchema !== undefined) {
    throw new TablePrefixError('setSchema er ikke tillatt i migreringer');
  }
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) walk(child);
  }
}

// ---------- FULLTEXT ----------

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DD_IDENTIFIER = /^dd_[a-z0-9_]+$/;

/**
 * `CREATE FULLTEXT INDEX` for en `dd_`-tabell. Kysely 0.29 kan ikke lage FULLTEXT-indekser, og
 * vernet godtar ikke rå SQL, så migreringene får denne i stedet. Indeksen og tabellen må hete
 * `dd_…`, og kolonnene må være enkle navn (`[a-z_][a-z0-9_]*`), uten database eller tabell foran.
 * Navnene settes inn som identifikatorer med `sql.id`, aldri som tekst. Kaster `TablePrefixError`.
 */
export function fulltextIndexQuery(
  index: string,
  table: string,
  columns: readonly string[],
): RawBuilder<unknown> {
  if (typeof index !== 'string' || !DD_IDENTIFIER.test(index)) {
    throw new TablePrefixError(`FULLTEXT-indeksen «${String(index)}» må hete dd_ med a–z, 0–9 og _`);
  }
  if (typeof table !== 'string' || !table.startsWith(TABLE_PREFIX)) {
    throw new TablePrefixError(`tabellen «${String(table)}» mangler prefikset`);
  }
  if (!DD_IDENTIFIER.test(table)) {
    throw new TablePrefixError(`tabellen «${table}» har et ugyldig navn eller ligger i en annen database`);
  }
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 16) {
    throw new TablePrefixError('FULLTEXT-indeksen må ha 1–16 kolonner');
  }
  for (const column of columns) {
    if (typeof column !== 'string' || !IDENTIFIER.test(column)) {
      throw new TablePrefixError(`FULLTEXT-indeksen har en ugyldig kolonne «${String(column)}»`);
    }
  }
  if (new Set(columns).size !== columns.length) {
    throw new TablePrefixError('FULLTEXT-indeksen har samme kolonne flere ganger');
  }
  return sql`create fulltext index ${sql.id(index)} on ${sql.id(table)} (${sql.join(
    columns.map((c) => sql.id(c)),
  )})`;
}

/** Kaster `TablePrefixError` hvis spørringen ikke er en tillatt skjemaendring på dd_-tabeller. */
export function assertMigrationQuery(node: RootOperationNode): void {
  if (!ALLOWED_ROOTS.has(node.kind)) {
    throw new TablePrefixError(`${node.kind} er ikke tillatt i migreringer`);
  }
  walk(node);
}

/**
 * Kysely-plugin som brukes på alle spørringer fra migreringene. Den slipper bare gjennom
 * CREATE/ALTER/DROP TABLE og CREATE/DROP INDEX på tabeller med `dd_`, og bare rå SQL fra
 * `ddl`. Migratorens egne spørringer mot dd_migrations går ikke gjennom den, og heller ikke
 * `fulltextIndexQuery`, som sjekker navnene selv.
 */
export class TablePrefixGuardPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    assertMigrationQuery(args.node);
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}
