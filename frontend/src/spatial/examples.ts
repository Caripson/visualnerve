import { blankGraph, newEdge, newNode, type Graph } from '../model/types';

/** Ordinary topics and links, with the same readable layout in 2D and 3D relief. */
export function createSpatialExample(name = 'Truck lifecycle'): Graph {
  const graph = blankGraph(name, 'mindmap');
  graph.diagram.description =
    'Follow a truck from manufacturing to recycling. Rotate the connected topics to inspect a lifecycle stage, or return to the same 2D overview.';
  graph.diagram.settings.spatialView = { version: 1, mode: '3d' };
  graph.diagram.metadata = { example: 'spatial-mindmap' };
  const lifecycle = newNode(graph.diagram.id, {
    title: 'Truck lifecycle',
    description: 'Explore the stages, decisions and activities throughout a truck’s life.',
    x: 820,
    y: 550,
    width: 260,
    height: 120,
    color: '#d7e7ec',
  });
  graph.nodes.push(lifecycle);
  const stages: {
    title: string;
    description: string;
    color: string;
    status?: string;
    topics: { title: string; description: string }[];
  }[] = [
    {
      title: 'Manufacturing',
      description: 'Turn the specification into a truck ready for delivery.',
      color: '#5c9fe5',
      status: 'done',
      topics: [
        {
          title: 'Design and specification',
          description: 'Define the configuration and intended work.',
        },
        { title: 'Assembly', description: 'Bring together the vehicle systems and components.' },
        { title: 'Quality checks', description: 'Check the finished vehicle and record findings.' },
      ],
    },
    {
      title: 'Delivery',
      description: 'Hand over the vehicle and introduce it to the fleet.',
      color: '#e6b74f',
      status: 'done',
      topics: [
        {
          title: 'Handover',
          description: 'Transfer the vehicle, documentation and open questions.',
        },
        {
          title: 'Registration',
          description: 'Track the records needed before the vehicle enters service.',
        },
        {
          title: 'Fleet onboarding',
          description: 'Assign the vehicle and introduce drivers and operators.',
        },
      ],
    },
    {
      title: 'Operation',
      description: 'Understand how the truck is used in everyday work.',
      color: '#79ba8b',
      topics: [
        {
          title: 'Routes and loads',
          description: 'Explore assignments, routes and the work the truck performs.',
        },
        {
          title: 'Driver feedback',
          description: 'Collect observations and questions from the people using it.',
        },
        {
          title: 'Fuel and energy',
          description: 'Connect energy use to the truck’s assignments and operating conditions.',
        },
      ],
    },
    {
      title: 'Maintenance',
      description: 'Plan work that keeps the truck available and useful.',
      color: '#b793dc',
      topics: [
        { title: 'Inspections', description: 'Record checks, observations and work to follow up.' },
        { title: 'Repairs', description: 'Track faults, repair decisions and completed work.' },
        {
          title: 'Spare parts',
          description: 'Connect needed components to repairs and stock planning.',
        },
      ],
    },
    {
      title: 'Second life',
      description: 'Consider how the truck can serve another purpose or owner.',
      color: '#e29077',
      topics: [
        { title: 'Refurbishment', description: 'Identify the changes needed for continued use.' },
        {
          title: 'Resale',
          description: 'Collect the vehicle history and decisions for a new owner.',
        },
        {
          title: 'New assignment',
          description: 'Match the truck to a different role or operating environment.',
        },
      ],
    },
    {
      title: 'Recycling',
      description: 'Separate reusable components and recover materials at the end of service.',
      color: '#71bdbd',
      topics: [
        {
          title: 'Dismantling',
          description: 'Plan the separation and handling of vehicle components.',
        },
        { title: 'Reusable components', description: 'Identify parts that may be used again.' },
        {
          title: 'Material recovery',
          description: 'Track material streams and their next destinations.',
        },
      ],
    },
  ];
  const link = (parentId: string, childId: string) =>
    graph.edges.push(
      newEdge(graph.diagram.id, parentId, childId, { edgeType: 'hierarchy', direction: 'none' }),
    );
  for (const [index, stage] of stages.entries()) {
    const left = index < 3;
    const row = index % 3;
    const node = newNode(graph.diagram.id, {
      externalId: 'lifecycle:' + index,
      title: stage.title,
      description: stage.description,
      color: stage.color,
      status: stage.status,
      parentId: lifecycle.id,
      x: left ? 420 : 1200,
      y: 130 + row * 420,
      width: 260,
      height: 120,
    });
    graph.nodes.push(node);
    link(lifecycle.id, node.id);
    for (const [topicIndex, topic] of stage.topics.entries()) {
      const child = newNode(graph.diagram.id, {
        externalId: 'lifecycle:' + index + ':' + topicIndex,
        title: topic.title,
        description: topic.description,
        parentId: node.id,
        color: stage.color,
        x: left ? 70 : 1540,
        y: row * 420 + topicIndex * 130,
        width: 300,
        height: 100,
      });
      graph.nodes.push(child);
      link(node.id, child.id);
    }
  }
  return graph;
}
