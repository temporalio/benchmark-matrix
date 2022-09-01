import temporal from 'k6/x/temporal';
import { scenario } from 'k6/execution';

export default () => {
    const client = temporal.newClient()

    client.startWorkflow(
        {
            task_queue: 'benchmark',
            id: 'echo-' + scenario.iterationInTest,
        },
        'ExecuteActivity',
        {"Count": 1, "Activity": "Echo", "Input": {"Message": "test"}},
    ).result()

    client.close()
};