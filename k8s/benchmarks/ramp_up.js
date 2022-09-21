import temporal from 'k6/x/temporal';
import { scenario } from 'k6/execution';
import { tagWithCurrentStageIndex } from 'https://jslib.k6.io/k6-utils/1.3.0/index.js';

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '10m', target: 1000 },
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