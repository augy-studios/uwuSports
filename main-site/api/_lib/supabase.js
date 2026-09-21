/* A tiny Supabase REST client.

   Hand written rather than pulling in @supabase/supabase-js, because this
   project has no build step and needs exactly two verbs: select and upsert.
   Everything goes through the PostgREST endpoint with the service role key,
   which never reaches the browser.

   If SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset, hasSupabase()
   returns false and every caller falls back to working without a database.
   That is deliberate: the site should deploy and serve before anybody has
   configured Postgres. */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function hasSupabase() {
  return Boolean(URL_BASE && SERVICE_KEY);
}

function endpoint(table) {
  return `${URL_BASE.replace(/\/$/, "")}/rest/v1/${table}`;
}

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

class Query {
  constructor(table) {
    this.table = table;
    this.params = new URLSearchParams();
    this.columns = "*";
  }

  select(columns) {
    this.columns = columns || "*";
    return this;
  }

  eq(column, value) {
    this.params.set(column, `eq.${value}`);
    return this;
  }

  limit(n) {
    this.params.set("limit", String(n));
    return this;
  }

  async maybeSingle() {
    const result = await this.run();
    if (result.error) return result;
    return { data: result.data?.[0] ?? null, error: null };
  }

  async run() {
    if (!hasSupabase()) return { data: null, error: new Error("Supabase is not configured") };

    this.params.set("select", this.columns);

    try {
      const response = await fetch(`${endpoint(this.table)}?${this.params}`, {
        headers: headers(),
      });

      if (!response.ok) {
        return { data: null, error: new Error(`Supabase returned ${response.status}`) };
      }

      return { data: await response.json(), error: null };
    } catch (cause) {
      return { data: null, error: cause };
    }
  }

  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }

  async upsert(row, { onConflict } = {}) {
    if (!hasSupabase()) return { data: null, error: new Error("Supabase is not configured") };

    const params = new URLSearchParams();
    if (onConflict) params.set("on_conflict", onConflict);

    try {
      const response = await fetch(`${endpoint(this.table)}?${params}`, {
        method: "POST",
        headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(Array.isArray(row) ? row : [row]),
      });

      if (!response.ok) {
        return { data: null, error: new Error(`Supabase returned ${response.status}`) };
      }

      return { data: null, error: null };
    } catch (cause) {
      return { data: null, error: cause };
    }
  }

  async delete() {
    if (!hasSupabase()) return { data: null, error: new Error("Supabase is not configured") };

    try {
      const response = await fetch(`${endpoint(this.table)}?${this.params}`, {
        method: "DELETE",
        headers: headers({ Prefer: "return=minimal" }),
      });

      if (!response.ok) {
        return { data: null, error: new Error(`Supabase returned ${response.status}`) };
      }

      return { data: null, error: null };
    } catch (cause) {
      return { data: null, error: cause };
    }
  }
}

export function supabase() {
  return {
    from(table) {
      return new Query(table);
    },
  };
}
