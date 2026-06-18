const appUrl = process.env.APP_URL || 'http://127.0.0.1:5173';
const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const result = await check();
    if (result) return result;
    await sleep(200);
  }
  throw new Error(message);
}

async function createPage() {
  const response = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(appUrl)}`, {
    method: 'PUT',
  });
  if (!response.ok) throw new Error(`Could not create browser page: ${response.status}`);
  return response.json();
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    events.push(message);
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  return {
    events,
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      socket.close();
    },
  };
}

async function run() {
  const page = await createPage();
  const client = connect(page.webSocketDebuggerUrl);
  const customerName = `E2E Customer ${Date.now()}`;

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    }
    return result.result.value;
  };

  const bodyText = () => evaluate('document.body?.innerText || ""');
  const path = () => evaluate('location.pathname');
  const clickByText = (text) => evaluate(`(() => {
    const element = [...document.querySelectorAll('button, a')]
      .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  const setInput = async (name, value) => {
    const focused = await evaluate(`(() => {
    const input = document.querySelector('[name="${name}"]');
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  })()`);
    if (!focused) throw new Error(`Input ${name} was not found`);
    await client.send('Input.insertText', { text: value });
  };

  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Log.enable');
    await client.send('Page.navigate', { url: `${appUrl}/login` });
    await waitFor(async () => (await path()) === '/login', 'Login route did not load');
    await evaluate('localStorage.clear(); sessionStorage.clear();');
    await client.send('Page.navigate', { url: `${appUrl}/login` });

    await waitFor(async () => (await bodyText()).includes('Please log in to your account'), 'Login page did not render');
    if ((await bodyText()).includes('Simple Test')) throw new Error('Placeholder application rendered');

    if (!(await clickByText('Sign in'))) throw new Error('Sign in button was not found');
    await waitFor(async () => (await path()) === '/dashboard', 'Login did not reach dashboard');
    await waitFor(async () => (await bodyText()).includes('Dashboard'), 'Dashboard did not render');

    await client.send('Page.navigate', { url: `${appUrl}/contacts/customers` });
    await waitFor(async () => (await bodyText()).includes('Customers'), 'Customer list did not render');
    await waitFor(async () => !(await bodyText()).includes('Loading...'), 'Customer list did not finish loading');

    if (!(await clickByText('New Customer'))) throw new Error('New Customer action was not found');
    await waitFor(async () => (await path()).endsWith('/create'), 'Customer create page did not open');
    await setInput('name', customerName);
    await setInput('email', `e2e-${Date.now()}@example.com`);
    await setInput('creditLimit', '1000');
    if (!(await clickByText('Create Customer'))) throw new Error('Create Customer button was not found');
    await waitFor(async () => (await path()) === '/contacts/customers', 'Customer was not created');
    await waitFor(async () => (await bodyText()).includes(customerName), 'Created customer was not listed');

    const opened = await evaluate(`(() => {
      const row = [...document.querySelectorAll('tbody tr')]
        .find((node) => node.textContent.includes(${JSON.stringify(customerName)}));
      const button = row?.querySelectorAll('button')[0];
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error('Created customer view action was not found');
    await waitFor(async () => (await bodyText()).includes('Customer Details'), 'Customer details did not render');
    await waitFor(async () => (await bodyText()).includes(customerName), 'Customer details were incorrect');

    if (!(await clickByText('Edit'))) throw new Error('Edit customer action was not found');
    await waitFor(async () => (await path()).endsWith('/edit'), 'Customer edit page did not open');
    await setInput('city', 'Pune');
    if (!(await clickByText('Update Customer'))) throw new Error('Update Customer button was not found');
    await waitFor(async () => (await path()) === '/contacts/customers', 'Customer update did not complete');
    await waitFor(async () => (await bodyText()).includes('Pune'), 'Updated customer was not listed');

    const deleteOpened = await evaluate(`(() => {
      const row = [...document.querySelectorAll('tbody tr')]
        .find((node) => node.textContent.includes(${JSON.stringify(customerName)}));
      const button = row?.querySelectorAll('button')[2];
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!deleteOpened) throw new Error('Delete customer action was not found');
    await waitFor(async () => (await bodyText()).includes('Delete Customer'), 'Delete confirmation did not open');
    if (!(await clickByText('Delete'))) throw new Error('Delete confirmation button was not found');
    await waitFor(async () => !(await bodyText()).includes(customerName), 'Customer was not deleted');

    const browserErrors = client.events.filter((event) =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
    );
    if (browserErrors.length) {
      throw new Error(`Browser reported ${browserErrors.length} runtime error(s)`);
    }

    console.log('E2E smoke passed: login, dashboard, customer create/view/edit/delete');
  } catch (error) {
    const currentPath = await path().catch(() => '<unavailable>');
    const currentBody = await bodyText().catch(() => '<unavailable>');
    const relevantEvents = client.events.filter((event) =>
      event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded'
    );
    console.error(`Browser path: ${currentPath}`);
    console.error(`Browser text: ${currentBody.slice(0, 2000)}`);
    console.error(`Browser events: ${JSON.stringify(relevantEvents, null, 2)}`);
    throw error;
  } finally {
    client.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
