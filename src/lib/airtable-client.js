const AIRTABLE_API_ROOT = 'https://api.airtable.com/v0';
const AIRTABLE_META_API_ROOT = 'https://api.airtable.com/v0/meta';

class AirtableClient {
  constructor({ apiKey, baseId }) {
    this.apiKey = apiKey;
    this.baseId = baseId;
  }

  async request(path, { method = 'GET', body } = {}) {
    return this.#requestJson(`${AIRTABLE_API_ROOT}${path}`, { method, body });
  }

  async metaRequest(path, { method = 'GET', body } = {}) {
    return this.#requestJson(`${AIRTABLE_META_API_ROOT}${path}`, { method, body });
  }

  async #requestJson(url, { method = 'GET', body } = {}) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Airtable request failed (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async fetchAllRecords({ tableName, fields = [], view, filterByFormula, sort }) {
    const records = [];
    let offset;

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '100');

      for (const field of fields) {
        params.append('fields[]', field);
      }

      if (view) {
        params.set('view', view);
      }

      if (filterByFormula) {
        params.set('filterByFormula', filterByFormula);
      }

      if (Array.isArray(sort)) {
        for (let index = 0; index < sort.length; index += 1) {
          const sortItem = sort[index];
          if (!sortItem || !sortItem.field) {
            continue;
          }

          params.append(`sort[${index}][field]`, sortItem.field);
          if (sortItem.direction) {
            params.append(`sort[${index}][direction]`, sortItem.direction);
          }
        }
      }

      if (offset) {
        params.set('offset', offset);
      }

      const payload = await this.request(`/${this.baseId}/${encodeURIComponent(tableName)}?${params.toString()}`);
      records.push(...payload.records);
      offset = payload.offset;
    } while (offset);

    return records;
  }

  async updateRecords({ tableName, records }) {
    return this.request(`/${this.baseId}/${encodeURIComponent(tableName)}`, {
      method: 'PATCH',
      body: { records }
    });
  }

  async createRecords({ tableName, records }) {
    return this.request(`/${this.baseId}/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      body: { records }
    });
  }

  async deleteRecords({ tableName, recordIds }) {
    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      return { records: [] };
    }

    const params = new URLSearchParams();

    for (const recordId of recordIds) {
      params.append('records[]', recordId);
    }

    return this.request(`/${this.baseId}/${encodeURIComponent(tableName)}?${params.toString()}`, {
      method: 'DELETE'
    });
  }

  async listTables() {
    const payload = await this.metaRequest(`/bases/${this.baseId}/tables`);
    return payload.tables || [];
  }

  async createField({ tableId, field }) {
    return this.metaRequest(`/bases/${this.baseId}/tables/${tableId}/fields`, {
      method: 'POST',
      body: field
    });
  }
}

module.exports = { AirtableClient };
