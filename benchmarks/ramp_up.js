import temporal from 'k6/x/temporal';
import { scenario } from 'k6/execution';

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 500,
      stages: [
        { duration: '2m', target: 500 },
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
