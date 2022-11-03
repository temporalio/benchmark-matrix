import temporal from 'k6/x/temporal';
import promclient from 'k6/x/prometheus-client';
import { scenario } from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 500,
      stages: [
        { duration: '2m', target: 500 },
        { duration: '10s', target: 600 },
        { duration: '2m', target: 600 },
        { duration: '10s', target: 700 },
        { duration: '2m', target: 700 },
        { duration: '10s', target: 800 },
        { duration: '2m', target: 800 },
        { duration: '10s', target: 900 },
        { duration: '2m', target: 900 },
        { duration: '10s', target: 1000 },
        { duration: '2m', target: 1000 },
      ],
    },
  },
};

const startWorkflow = (client) => {
  while(true) {
    try {
      const workflow = client.startWorkflow(
        {
          task_queue: 'benchmark',
          id: 'echo-' + scenario.iterationInTest,
        },
        'ExecuteActivity',
        { "Count": 1, "Activity": "Echo", "Input": { "Message": "test" } },
      )

      return workflow;
    } catch (err) { console.log("Retrying...", err); }
  }
}

const waitForWorkflowCompletion = (workflow) => {
  while(true) {
    try {
      workflow.result()
      return
    } catch (err) { console.log("Retrying...", err); }
  }
}

export default () => {
  const client = temporal.newClient()
  
  const workflow = startWorkflow(client);
  waitForWorkflowCompletion(workflow)
  
  client.close()
};

const queryProm = (query) => {
  const prom = promclient.newClient(__ENV.PROMETHEUS_ENDPOINT)

  const [result, warnings] = prom.query(query, new Date());

  if (warnings.length) {
     console.warn("Prometheus warnings:", warnings)
  }

  return result
}

export function handleSummary(data) {
  delete(data.metrics.data_sent);
  delete(data.metrics.data_received);

  data.metrics.actions = {
    "type": "counter",
    "values": {
      "count": queryProm('sum(action{namespace="default"})')[0].value,
      "rate": queryProm('max_over_time(sum(rate(action{namespace="default"}[1m]))[15m:30s])')[0].value,
    }
  }

  return {
    'stdout': textSummary(data)
  };
};