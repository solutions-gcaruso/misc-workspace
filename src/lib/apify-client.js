const APIFY_API_ROOT = 'https://api.apify.com/v2';
const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const RETRIABLE_STATUSES = new Set([408, 409, 423, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ApifyClient {
  constructor({
    token,
    pollIntervalMs = 2_000,
    timeoutMs = 10 * 60 * 1_000,
    maxRetries = 3
  }) {
    if (!token) {
      throw new Error('Missing required Apify token');
    }

    this.token = token;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  buildUrl(pathname, searchParams = {}) {
    const url = new URL(`${APIFY_API_ROOT}${pathname}`);
    url.searchParams.set('token', this.token);

    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url;
  }

  async request(pathname, { method = 'GET', body, searchParams } = {}) {
    const url = this.buildUrl(pathname, searchParams);
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json'
          },
          body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`Apify request failed (${response.status}): ${errorText}`);
          error.status = response.status;

          if (RETRIABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
            lastError = error;
            await sleep((attempt + 1) * 1_000);
            continue;
          }

          throw error;
        }

        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        lastError = error;

        if (attempt >= this.maxRetries) {
          break;
        }

        await sleep((attempt + 1) * 1_000);
      }
    }

    throw lastError;
  }

  async startActorRun({ actorId, input }) {
    const payload = await this.request(`/acts/${encodeURIComponent(actorId)}/runs`, {
      method: 'POST',
      body: input
    });

    return payload.data;
  }

  async getRun(runId) {
    const payload = await this.request(`/actor-runs/${encodeURIComponent(runId)}`);
    return payload.data;
  }

  async waitForRun(runId, { pollIntervalMs = this.pollIntervalMs, timeoutMs = this.timeoutMs } = {}) {
    const startedAt = Date.now();

    while (true) {
      const run = await this.getRun(runId);

      if (TERMINAL_RUN_STATUSES.has(run.status)) {
        if (run.status !== 'SUCCEEDED') {
          throw new Error(`Apify actor run ${runId} ended with status ${run.status}`);
        }

        return run;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for Apify actor run ${runId}`);
      }

      await sleep(pollIntervalMs);
    }
  }

  async getDatasetItems(datasetId) {
    return this.request(`/datasets/${encodeURIComponent(datasetId)}/items`, {
      searchParams: {
        clean: 'true'
      }
    });
  }

  async runActorAndGetItems({ actorId, input }) {
    const startedRun = await this.startActorRun({ actorId, input });
    const completedRun = await this.waitForRun(startedRun.id);
    const items = await this.getDatasetItems(completedRun.defaultDatasetId);

    return {
      run: completedRun,
      items: Array.isArray(items) ? items : []
    };
  }
}

module.exports = {
  ApifyClient,
  sleep
};
