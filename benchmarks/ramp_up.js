import temporal from 'k6/x/temporal';
import { scenario } from 'k6/execution';
import { tagWithCurrentStageIndex } from 'https://jslib.k6.io/k6-utils/1.3.0/index.js';

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

export default () => {
  tagWithCurrentStageIndex();

  const client = temporal.newClient()

  client.startWorkflow(
    {
      task_queue: 'benchmark',
      id: 'echo-' + scenario.iterationInTest,
    },
    'ExecuteActivity',
    { "Count": 1, "Activity": "Echo", "Input": { "Message": "test" } },
  ).result()

  client.close()
};