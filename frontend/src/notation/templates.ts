import { blankGraph, newEdge, newNode, type Graph, type GraphNode } from '../model/types';
import { getNotationSymbol } from './registry';
import type {
  EdgeNotation,
  NodeNotation,
  NotationCollectionId,
  NotationCompartment,
  NotationDiagramKind,
  NotationPort,
  NotationProfile,
  UmlDiagramKind,
} from './types';

interface NodeOptions extends Omit<Partial<GraphNode>, 'notation'> {
  properties?: NodeNotation['properties'];
  compartments?: NotationCompartment[];
  ports?: NotationPort[];
  attachmentId?: string;
  relatedNodeId?: string;
  diagramKind?: NotationDiagramKind;
}
type EdgeOptions = Omit<Partial<EdgeNotation>, 'collection' | 'symbol'>;

/** Examples use the same portable notation fields as ordinary editing and the API. */
class Example {
  readonly graph: Graph;
  constructor(
    readonly profile: NotationProfile,
    name: string,
    description: string,
  ) {
    this.graph = blankGraph(name, 'freeform');
    this.graph.diagram.notation = profile;
    this.graph.diagram.description = description;
    this.graph.diagram.tags = [profile.collection, profile.diagramKind, 'notation-example'];
  }
  node(symbol: string, title: string, x: number, y: number, options: NodeOptions = {}) {
    const descriptor = getNotationSymbol(this.profile.collection, symbol);
    if (!descriptor)
      throw new Error(`Unknown example symbol: ${this.profile.collection}/${symbol}`);
    const {
      properties,
      compartments,
      ports,
      attachmentId,
      relatedNodeId,
      diagramKind = this.profile.diagramKind,
      ...native
    } = options;
    const notation = {
      collection: this.profile.collection,
      symbol,
      diagramKind,
      ...(properties ? { properties } : {}),
      ...(compartments ? { compartments } : {}),
      ...(ports ? { ports } : {}),
      ...(attachmentId ? { attachmentId } : {}),
      ...(relatedNodeId ? { relatedNodeId } : {}),
    } as NodeNotation;
    const node = newNode(this.graph.diagram.id, {
      title,
      x,
      y,
      ...descriptor.defaultSize,
      nodeType: descriptor.container ? 'group' : 'generic',
      color: '#47766B',
      description: `${descriptor.label}. ${descriptor.source.title}; ${descriptor.source.locator}.`,
      tags: [this.profile.collection, diagramKind, 'notation-example'],
      notation,
      ...native,
    });
    this.graph.nodes.push(node);
    return node;
  }
  edge(
    symbol: string,
    source: GraphNode,
    target: GraphNode,
    label?: string,
    options: EdgeOptions = {},
  ) {
    const notation = { collection: this.profile.collection, symbol, ...options } as EdgeNotation;
    const edge = newEdge(this.graph.diagram.id, source.id, target.id, {
      edgeType: symbol,
      label,
      notation,
      description: label ? `${symbol}: ${label}` : `${this.profile.collection} ${symbol}`,
    });
    this.graph.edges.push(edge);
    return edge;
  }
}
const sections = (...values: [string, string[]][]): NotationCompartment[] =>
  values.map(([id, lines]) => ({
    id,
    title: id.replaceAll('-', ' ').replace(/^./, (value) => value.toUpperCase()),
    lines,
  }));
const profile = (collection: NotationCollectionId, diagramKind: NotationDiagramKind) =>
  ({ schemaVersion: 1, collection, diagramKind }) as NotationProfile;
const vertical: EdgeOptions = { sourcePort: 'bottom', targetPort: 'top' };

function hipo(name: string) {
  const e = new Example(
    profile('hipo', 'vtoc'),
    name,
    'HIPO order documentation: a numbered visual table of contents links to an overview IPO and a detailed IPO. The hierarchy describes functional decomposition; data, action and reference arrows have separate meanings. Based on IBM HIPO documentation, not an executable program.',
  );
  const root = e.node('vtoc-module', '1 · Fulfil order', 380, 0, {
    properties: { moduleNumber: '1' },
  });
  const validate = e.node('vtoc-module', '2 · Validate request', 0, 190, {
    properties: { moduleNumber: '2' },
  });
  const reserve = e.node('vtoc-module', '3 · Reserve stock', 380, 190, {
    properties: { moduleNumber: '3' },
  });
  const dispatch = e.node('vtoc-module', '4 · Confirm delivery', 760, 190, {
    properties: { moduleNumber: '4' },
  });
  for (const child of [validate, reserve, dispatch])
    e.edge('hierarchy', root, child, undefined, vertical);
  const overview = e.node('ipo-chart', '1 · Fulfil order — overview', 0, 440, {
    width: 1060,
    height: 390,
    diagramKind: 'overview-ipo',
    properties: { moduleNumber: '1', detail: 'overview' },
    compartments: sections(
      ['input', ['Order request', 'Customer account', 'Stock balance']],
      ['process', ['2 · Validate request', '3 · Reserve stock', '4 · Confirm delivery']],
      ['output', ['Accepted order', 'Reservation record', 'Delivery confirmation']],
    ),
    relatedNodeId: root.id,
  });
  const detail = e.node('ipo-chart', '3 · Reserve stock — detail', 0, 1000, {
    width: 1060,
    height: 510,
    diagramKind: 'detail-ipo',
    properties: { moduleNumber: '3', detail: 'detail' },
    compartments: sections(
      ['input', ['Accepted order', 'Available stock']],
      [
        'process',
        [
          '1 · Check requested quantities',
          '2 · Allocate available items',
          '3 · Record reservation',
        ],
      ],
      ['output', ['Reservation record', 'Updated stock', 'Shortage notice']],
      [
        'extended-description',
        [
          '1 · Compare each line against available quantity.',
          '2 · Reserve only quantities confirmed available.',
          '3 · Store the allocation reference for delivery.',
        ],
      ],
    ),
    relatedNodeId: reserve.id,
  });
  root.notation!.relatedNodeId = overview.id;
  reserve.notation!.relatedNodeId = detail.id;
  e.edge('reference', root, overview, 'Overview IPO', vertical);
  e.edge('reference', reserve, detail, 'Detail IPO', {
    sourcePort: 'right',
    targetPort: 'right',
    waypoints: [
      [1150, 240],
      [1150, 1255],
    ],
  });
  e.edge('reference', overview, detail, 'Expand function 3', vertical);
  return e.graph;
}

function dfd(name: string, collection: 'dfd-yourdon' | 'dfd-gane-sarson') {
  const e = new Example(
    profile(collection, 'data-flow'),
    name,
    'Order processing data-flow diagram: external Customer and Warehouse entities exchange named data with numbered processes; Orders and Inventory are data stores. Arrows show information movement, not execution order. Use one dialect consistently.',
  );
  const customer = e.node('external-entity', 'Customer', 0, 200);
  const receive = e.node('process', 'Receive order', 330, 170, {
    properties: { number: '1', level: 1 },
  });
  const fulfil = e.node('process', 'Allocate items', 690, 170, {
    properties: { number: '2', level: 1 },
  });
  const warehouse = e.node('external-entity', 'Warehouse', 1050, 200);
  const orders = e.node('data-store', 'Orders', 330, 0, { properties: { number: 'D1' } });
  const inventory = e.node('data-store', 'Inventory', 690, 490, { properties: { number: 'D2' } });
  e.edge('data-flow', customer, receive, 'Order request');
  e.edge('data-flow', receive, customer, 'Order acknowledgement', {
    sourcePort: 'bottom',
    targetPort: 'bottom',
    waypoints: [
      [430, 400],
      [100, 400],
    ],
  });
  e.edge('data-flow', receive, orders, 'Accepted order', {
    sourcePort: 'top',
    targetPort: 'bottom',
  });
  e.edge('data-flow', receive, fulfil, 'Accepted order lines');
  e.edge('data-flow', inventory, fulfil, 'Available quantities', {
    sourcePort: 'top',
    targetPort: 'bottom',
  });
  e.edge('data-flow', fulfil, inventory, 'Stock allocation', {
    sourcePort: 'bottom',
    targetPort: 'right',
    waypoints: [
      [930, 460],
      [930, 540],
    ],
  });
  e.edge('data-flow', fulfil, warehouse, 'Pick list');
  e.edge('data-flow', warehouse, fulfil, 'Picked items', {
    sourcePort: 'bottom',
    targetPort: 'bottom',
    waypoints: [
      [1150, 405],
      [790, 405],
    ],
  });
  return e.graph;
}

function uml(name: string, kind: UmlDiagramKind) {
  const e = new Example(
    profile('uml', kind),
    name,
    `Editable UML ${kind} example for an order service. The symbol, compartments, named ports and relationship ends are saved notation values based on UML 2.5.1. This example documents a design; it does not execute or generate code.`,
  );
  switch (kind) {
    case 'class': {
      const customer = e.node('class', 'Customer', 0, 0, {
        compartments: sections(
          ['attributes', ['- id: UUID', '- email: String']],
          ['operations', ['+ placeOrder(): Order']],
        ),
      });
      const order = e.node('class', 'Order', 360, 0, {
        compartments: sections(
          ['attributes', ['- number: String', '- total: Decimal']],
          ['operations', ['+ confirm()', '+ cancel()']],
        ),
      });
      const line = e.node('class', 'OrderLine', 720, 0, {
        compartments: sections(
          ['attributes', ['- quantity: Integer', '- price: Decimal']],
          ['operations', ['+ subtotal(): Decimal']],
        ),
      });
      const gateway = e.node('interface', 'PaymentGateway', 360, 360, {
        compartments: sections(['operations', ['+ authorize(amount): Result']]),
      });
      const payment = e.node('class', 'CardPayment', 720, 360, {
        compartments: sections(['operations', ['+ authorize(amount): Result']]),
      });
      e.edge('association', customer, order, 'places', {
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
      });
      e.edge('composition', order, line, 'lines', {
        sourceMultiplicity: '1',
        targetMultiplicity: '1..*',
      });
      e.edge('dependency', order, gateway, 'uses', vertical);
      e.edge('realization', payment, gateway, undefined, {
        sourcePort: 'left',
        targetPort: 'right',
      });
      break;
    }
    case 'object': {
      const order = e.node('object', 'order42: Order', 0, 0, {
        compartments: sections(['slots', ['number = "A-1042"', 'total = 48.00']]),
      });
      const first = e.node('object', 'line1: OrderLine', 390, 0, {
        compartments: sections(['slots', ['quantity = 2', 'price = 12.00']]),
      });
      const second = e.node('object', 'line2: OrderLine', 390, 300, {
        compartments: sections(['slots', ['quantity = 1', 'price = 24.00']]),
      });
      e.edge('link', order, first, 'lines');
      e.edge('link', order, second, 'lines', vertical);
      break;
    }
    case 'package': {
      const domain = e.node('package', 'Order domain', 0, 0, { width: 400, height: 280 });
      e.node('class', 'Order', 75, 90, { parentId: domain.id, width: 230, height: 130 });
      const api = e.node('package', 'Public API', 580, 0, { width: 400, height: 280 });
      e.node('interface', 'OrderService', 655, 90, { parentId: api.id, width: 230, height: 130 });
      const shared = e.node('package', 'Shared types', 290, 450, { width: 400, height: 230 });
      e.edge('dependency', api, domain, 'uses', { sourcePort: 'left', targetPort: 'right' });
      e.edge('package-import', domain, shared, '«import»', vertical);
      break;
    }
    case 'component': {
      const web = e.node('component', 'Web checkout', 0, 100);
      const orders = e.node('component', 'Order service', 470, 100);
      const payment = e.node('component', 'Payment adapter', 940, 100);
      const contract = e.node('interface', 'IOrders', 280, 0, { width: 150, height: 95 });
      const apiPort = e.node('port', 'orders', 450, 160, {
        width: 40,
        height: 40,
        attachmentId: orders.id,
      });
      e.edge('dependency', web, contract, 'requires');
      e.edge('realization', orders, contract, 'provides', {
        sourcePort: 'top',
        targetPort: 'bottom',
      });
      e.edge('connector', apiPort, web, 'assembly', { sourcePort: 'left', targetPort: 'right' });
      e.edge('dependency', orders, payment, 'authorize');
      break;
    }
    case 'composite-structure': {
      const service = e.node('class', 'OrderService', 0, 0, {
        nodeType: 'group',
        width: 950,
        height: 440,
      });
      const checkout = e.node('part', 'checkout: Checkout', 85, 150, {
        parentId: service.id,
        width: 270,
        height: 150,
      });
      const payment = e.node('part', 'payment: Payment', 530, 150, {
        parentId: service.id,
        width: 270,
        height: 150,
      });
      const input = e.node('port', 'submit', -20, 205, {
        width: 40,
        height: 40,
        attachmentId: service.id,
      });
      const output = e.node('port', 'authorize', 335, 205, {
        width: 40,
        height: 40,
        attachmentId: checkout.id,
      });
      e.edge('connector', input, checkout, 'delegation');
      e.edge('connector', output, payment, 'payment request');
      break;
    }
    case 'deployment': {
      const client = e.node('device', 'Customer device', 0, 0, { width: 330, height: 360 });
      e.node('artifact', 'checkout.html', 65, 150, {
        parentId: client.id,
        width: 210,
        height: 130,
      });
      const server = e.node('device', 'Application server', 530, 0, { width: 500, height: 500 });
      const runtime = e.node('execution-environment', 'Service runtime', 585, 115, {
        parentId: server.id,
        width: 390,
        height: 320,
      });
      e.node('artifact', 'orders-service.jar', 650, 240, {
        parentId: runtime.id,
        width: 260,
        height: 140,
      });
      e.edge('association', client, server, 'HTTPS');
      break;
    }
    case 'profile': {
      const scope = e.node('profile', 'Service design', 0, 0, { width: 960, height: 520 });
      const metaclass = e.node('class', 'Component', 90, 160, {
        parentId: scope.id,
        properties: { stereotype: 'metaclass' },
        width: 270,
        height: 180,
      });
      const stereotype = e.node('stereotype', 'Service', 565, 160, {
        parentId: scope.id,
        compartments: sections(['attributes', ['owner: String', 'tier: Integer']]),
        width: 290,
        height: 230,
      });
      e.edge('extension', stereotype, metaclass, undefined, {
        sourcePort: 'left',
        targetPort: 'right',
      });
      break;
    }
    case 'use-case': {
      const system = e.node('system-boundary', 'Order service', 280, 0, {
        width: 810,
        height: 650,
      });
      const customer = e.node('actor', 'Customer', 0, 190);
      const place = e.node('use-case', 'Place order', 410, 90, {
        parentId: system.id,
        width: 270,
        height: 140,
      });
      const pay = e.node('use-case', 'Authorize payment', 720, 300, {
        parentId: system.id,
        width: 270,
        height: 140,
      });
      const coupon = e.node('use-case', 'Apply coupon', 410, 470, {
        parentId: system.id,
        width: 270,
        height: 140,
      });
      e.edge('association', customer, place);
      e.edge('include', place, pay, '«include»', vertical);
      e.edge('extend', coupon, place, '«extend»', {
        sourcePort: 'top',
        targetPort: 'bottom',
        properties: { guard: 'coupon supplied' },
      });
      break;
    }
    case 'activity': {
      const initial = e.node('initial-node', 'Begin review', 0, 90, { width: 40, height: 40 });
      const review = e.node('action', 'Review order', 150, 35);
      const choice = e.node('decision', 'Accepted?', 495, 80, { width: 80, height: 80 });
      const pack = e.node('action', 'Pack order', 745, 35);
      const cancel = e.node('action', 'Cancel order', 415, 300);
      const final = e.node('activity-final', 'Review complete', 1110, 90, {
        width: 40,
        height: 40,
      });
      const output = e.node('object-node', 'Packed order', 745, 300);
      e.edge('control-flow', initial, review);
      e.edge('control-flow', review, choice);
      e.edge('control-flow', choice, pack, '[accepted]', { properties: { guard: 'accepted' } });
      e.edge('control-flow', choice, cancel, '[rejected]', {
        ...vertical,
        properties: { guard: 'rejected' },
      });
      e.edge('control-flow', pack, final);
      e.edge('object-flow', pack, output, 'result', vertical);
      e.edge('control-flow', cancel, final, undefined, {
        sourcePort: 'right',
        targetPort: 'bottom',
        waypoints: [[1140, 385]],
      });
      break;
    }
    case 'state-machine': {
      const initial = e.node('initial-state', 'Initialize order', 0, 85, { width: 40, height: 40 });
      const draft = e.node('state', 'Draft', 160, 30, {
        compartments: sections(['internal', ['entry / openCart', 'do / collectLines']]),
      });
      const submitted = e.node('state', 'Submitted', 535, 30, {
        compartments: sections(['internal', ['entry / reserveStock']]),
      });
      const shipped = e.node('state', 'Shipped', 910, 30);
      const final = e.node('final-state', 'Order lifecycle complete', 1260, 85, {
        width: 40,
        height: 40,
      });
      e.edge('transition', initial, draft);
      e.edge('transition', draft, submitted, 'submit [lines > 0] / freezeCart', {
        properties: { trigger: 'submit', guard: 'lines > 0', effect: 'freezeCart' },
      });
      e.edge('transition', submitted, shipped, 'dispatch', { properties: { trigger: 'dispatch' } });
      e.edge('transition', shipped, final, 'delivered', { properties: { trigger: 'delivered' } });
      break;
    }
    case 'sequence': {
      const customer = e.node('lifeline', 'customer: Customer', 0, 0, {
        width: 220,
        height: 850,
        ports: [
          { id: 'send-order', side: 'right', offset: 0.24 },
          { id: 'receive-result', side: 'right', offset: 0.82 },
        ],
      });
      const orders = e.node('lifeline', 'orders: OrderService', 470, 0, {
        width: 240,
        height: 850,
        ports: [
          { id: 'receive-order', side: 'left', offset: 0.24 },
          { id: 'send-authorize', side: 'right', offset: 0.43 },
          { id: 'receive-auth', side: 'right', offset: 0.64 },
          { id: 'send-result', side: 'left', offset: 0.82 },
        ],
      });
      const payment = e.node('lifeline', 'payments: Gateway', 960, 0, {
        width: 220,
        height: 850,
        ports: [
          { id: 'receive-authorize', side: 'left', offset: 0.43 },
          { id: 'send-auth', side: 'left', offset: 0.64 },
        ],
      });
      e.node('activation', 'Order execution', 570, 204, {
        width: 40,
        height: 493,
        attachmentId: orders.id,
      });
      e.node('activation', 'Authorization execution', 1050, 365, {
        width: 40,
        height: 180,
        attachmentId: payment.id,
      });
      e.edge('synchronous-message', customer, orders, 'placeOrder(lines)', {
        sourcePort: 'send-order',
        targetPort: 'receive-order',
      });
      e.edge('synchronous-message', orders, payment, 'authorize(total)', {
        sourcePort: 'send-authorize',
        targetPort: 'receive-authorize',
      });
      e.edge('reply', payment, orders, 'approved', {
        sourcePort: 'send-auth',
        targetPort: 'receive-auth',
      });
      e.edge('reply', orders, customer, 'orderNumber', {
        sourcePort: 'send-result',
        targetPort: 'receive-result',
      });
      break;
    }
    case 'communication': {
      const customer = e.node('object', 'customer: Customer', 0, 0);
      const order = e.node('object', 'orders: OrderService', 430, 0);
      const payment = e.node('object', 'payments: Gateway', 430, 370);
      e.edge('link', customer, order);
      e.edge('synchronous-message', customer, order, '1: placeOrder()', {
        sourcePort: 'bottom',
        targetPort: 'bottom',
        properties: { messageNumber: '1' },
      });
      e.edge('link', order, payment, undefined, vertical);
      e.edge('synchronous-message', order, payment, '1.1: authorize()', {
        sourcePort: 'right',
        targetPort: 'right',
        properties: { messageNumber: '1.1' },
        waypoints: [
          [820, 100],
          [820, 470],
        ],
      });
      break;
    }
    case 'interaction-overview': {
      const initial = e.node('initial-node', 'Begin interaction', 0, 75, { width: 40, height: 40 });
      const checkout = e.node('interaction-use', 'Checkout interaction', 140, 25);
      const decision = e.node('decision', 'Accepted?', 490, 60, { width: 80, height: 80 });
      const payment = e.node('interaction-use', 'Payment interaction', 735, 25);
      const retry = e.node('interaction-use', 'Resolve rejection', 410, 320);
      const final = e.node('activity-final', 'Interaction complete', 1110, 75, {
        width: 40,
        height: 40,
      });
      e.edge('control-flow', initial, checkout);
      e.edge('control-flow', checkout, decision);
      e.edge('control-flow', decision, payment, '[accepted]');
      e.edge('control-flow', decision, retry, '[rejected]', vertical);
      e.edge('control-flow', retry, checkout, undefined, {
        sourcePort: 'left',
        targetPort: 'bottom',
        waypoints: [[250, 395]],
      });
      e.edge('control-flow', payment, final);
      break;
    }
    case 'timing': {
      const order = e.node('timing-lifeline', 'order: Order', 0, 0, {
        width: 1160,
        height: 260,
        properties: {
          timeStart: 0,
          timeEnd: 30,
          timingStates: [
            { time: 0, state: 'Draft' },
            { time: 6, state: 'Submitted' },
            { time: 24, state: 'Shipped' },
          ],
        },
        compartments: sections(['states', ['Draft', 'Submitted', 'Shipped']]),
        ports: [
          { id: 'submit', side: 'bottom', offset: 0.36 },
          { id: 'ship', side: 'bottom', offset: 0.75 },
        ],
      });
      const payment = e.node('timing-lifeline', 'payment: Payment', 0, 420, {
        width: 1160,
        height: 260,
        properties: {
          timeStart: 0,
          timeEnd: 30,
          timingStates: [
            { time: 0, state: 'Idle' },
            { time: 8, state: 'Authorizing' },
            { time: 18, state: 'Approved' },
          ],
        },
        compartments: sections(['states', ['Idle', 'Authorizing', 'Approved']]),
        ports: [
          { id: 'authorize', side: 'top', offset: 0.42 },
          { id: 'approved', side: 'top', offset: 0.68 },
        ],
      });
      e.edge('asynchronous-message', order, payment, 'authorize', {
        sourcePort: 'submit',
        targetPort: 'authorize',
      });
      e.edge('reply', payment, order, 'approved {duration < 5 s}', {
        sourcePort: 'approved',
        targetPort: 'ship',
      });
      e.node('state-invariant', '{0 ≤ t ≤ 30 s}', 910, 765, { width: 250, height: 90 });
      break;
    }
  }
  return e.graph;
}

function bpmn(name: string, kind: 'process' | 'collaboration' | 'conversation' | 'choreography') {
  const e = new Example(
    profile('bpmn', kind),
    name,
    `BPMN ${kind} order example using typed activities, participants, events and connectors based on BPMN 2.0.2. This is an editable diagram with structural checks; it is not an executable BPMN engine or BPMN XML interchange model.`,
  );
  if (kind === 'conversation') {
    const customer = e.node('pool', 'Customer', 0, 100, { width: 300, height: 130 });
    const supplier = e.node('pool', 'Supplier', 1000, 100, { width: 300, height: 130 });
    const carrier = e.node('pool', 'Carrier', 510, 550, { width: 300, height: 130 });
    const conversation = e.node('conversation', 'Order fulfilment', 515, 50, {
      width: 290,
      height: 250,
    });
    e.edge('conversation-link', customer, conversation);
    e.edge('conversation-link', conversation, supplier);
    e.edge('conversation-link', conversation, carrier, undefined, vertical);
  } else if (kind === 'choreography') {
    const start = e.node('start-event', 'Begin exchange', 0, 80, { width: 80, height: 128 });
    const request = e.node('choreography-task', 'Submit order', 165, 0, {
      width: 330,
      height: 240,
      compartments: [
        { id: 'initiating-participant', lines: ['Customer'] },
        { id: 'activity', lines: [] },
        { id: 'other-participant', lines: ['Supplier'] },
      ],
    });
    const arrange = e.node('choreography-task', 'Arrange delivery', 645, 0, {
      width: 330,
      height: 240,
      compartments: [
        { id: 'initiating-participant', lines: ['Supplier'] },
        { id: 'activity', lines: [] },
        { id: 'other-participant', lines: ['Carrier'] },
      ],
    });
    const end = e.node('end-event', 'Delivery arranged', 1100, 80, { width: 80, height: 128 });
    e.edge('sequence-flow', start, request);
    e.edge('sequence-flow', request, arrange);
    e.edge('sequence-flow', arrange, end);
  } else if (kind === 'collaboration') {
    const customer = e.node('pool', 'Customer', 0, 0, { width: 1490, height: 340 });
    const supplier = e.node('pool', 'Supplier', 0, 530, { width: 1490, height: 400 });
    const send = e.node('task', 'Send order', 160, 110, {
      parentId: customer.id,
      properties: { taskType: 'send' },
      width: 260,
      height: 130,
    });
    const receive = e.node('task', 'Receive confirmation', 1020, 110, {
      parentId: customer.id,
      properties: { taskType: 'receive' },
      width: 280,
      height: 130,
    });
    const start = e.node('start-event', 'Order received', 160, 655, {
      parentId: supplier.id,
      properties: { eventDefinition: 'message' },
      width: 80,
      height: 128,
    });
    const fulfil = e.node('task', 'Fulfil order', 430, 620, {
      parentId: supplier.id,
      properties: { taskType: 'user' },
      width: 290,
      height: 150,
    });
    const confirm = e.node('task', 'Send confirmation', 1020, 620, {
      parentId: supplier.id,
      properties: { taskType: 'send' },
      width: 280,
      height: 150,
    });
    const end = e.node('end-event', 'Confirmation sent', 1370, 655, {
      parentId: supplier.id,
      width: 80,
      height: 128,
    });
    e.edge('sequence-flow', send, receive, 'Wait for supplier');
    e.edge('sequence-flow', start, fulfil);
    e.edge('sequence-flow', fulfil, confirm);
    e.edge('sequence-flow', confirm, end);
    e.edge('message-flow', send, start, 'Order', vertical);
    e.edge('message-flow', confirm, receive, 'Confirmation', {
      sourcePort: 'top',
      targetPort: 'bottom',
    });
  } else {
    const pool = e.node('pool', 'Order fulfilment', 0, 0, { width: 1780, height: 780 });
    const sales = e.node('lane', 'Sales', 95, 45, { parentId: pool.id, width: 1665, height: 355 });
    const fulfilment = e.node('lane', 'Fulfilment', 95, 400, {
      parentId: pool.id,
      width: 1665,
      height: 355,
    });
    const start = e.node('start-event', 'Request received', 215, 155, {
      parentId: sales.id,
      width: 80,
      height: 128,
    });
    const review = e.node('task', 'Review request', 320, 120, {
      parentId: sales.id,
      width: 270,
      height: 150,
      properties: { taskType: 'user' },
    });
    const choice = e.node('exclusive-gateway', 'Accepted?', 720, 145, {
      parentId: sales.id,
      width: 100,
      height: 148,
    });
    const reserve = e.node('task', 'Reserve stock', 1010, 120, {
      parentId: sales.id,
      width: 270,
      height: 150,
      properties: { taskType: 'service' },
    });
    const pack = e.node('subprocess', 'Pack items', 1010, 475, {
      parentId: fulfilment.id,
      width: 270,
      height: 165,
      properties: { collapsed: true },
    });
    const end = e.node('end-event', 'Order packed', 1500, 518, {
      parentId: fulfilment.id,
      width: 80,
      height: 128,
    });
    const rejected = e.node('end-event', 'Request rejected', 730, 505, {
      parentId: fulfilment.id,
      width: 80,
      height: 128,
    });
    const timer = e.node('boundary-event', 'Review overdue', 540, 230, {
      parentId: sales.id,
      width: 80,
      height: 128,
      attachmentId: review.id,
      properties: { eventDefinition: 'timer', nonInterrupting: true },
    });
    const reminder = e.node('task', 'Send reminder', 320, 485, {
      parentId: fulfilment.id,
      width: 270,
      height: 140,
      properties: { taskType: 'send' },
    });
    const data = e.node('data-object', 'Accepted order', 1340, 105, {
      parentId: sales.id,
      width: 140,
      height: 170,
    });
    e.edge('sequence-flow', start, review);
    e.edge('sequence-flow', review, choice);
    e.edge('sequence-flow', choice, reserve, 'Accepted', {
      properties: { condition: 'request accepted' },
    });
    e.edge('sequence-flow', choice, rejected, 'Otherwise', {
      ...vertical,
      properties: { default: true },
    });
    e.edge('sequence-flow', reserve, pack, undefined, vertical);
    e.edge('sequence-flow', pack, end);
    e.edge('sequence-flow', timer, reminder, 'After 1 day', vertical);
    e.edge('data-association', reserve, data, 'result');
  }
  return e.graph;
}

const definitions = [
  { key: 'hipo', name: 'HIPO', collection: 'hipo', diagramKind: 'vtoc', create: hipo },
  {
    key: 'dfd-yourdon-demarco',
    name: 'DFD · Yourdon–DeMarco',
    collection: 'dfd-yourdon',
    diagramKind: 'data-flow',
    create: (name: string) => dfd(name, 'dfd-yourdon'),
  },
  {
    key: 'dfd-gane-sarson',
    name: 'DFD · Gane–Sarson',
    collection: 'dfd-gane-sarson',
    diagramKind: 'data-flow',
    create: (name: string) => dfd(name, 'dfd-gane-sarson'),
  },
  ...(
    [
      ['class', 'Class'],
      ['object', 'Object'],
      ['package', 'Package'],
      ['component', 'Component'],
      ['composite-structure', 'Composite Structure'],
      ['deployment', 'Deployment'],
      ['profile', 'Profile'],
      ['use-case', 'Use Case'],
      ['activity', 'Activity'],
      ['state-machine', 'State Machine'],
      ['sequence', 'Sequence'],
      ['communication', 'Communication'],
      ['interaction-overview', 'Interaction Overview'],
      ['timing', 'Timing'],
    ] as const
  ).map(([diagramKind, label]) => ({
    key: `uml-${diagramKind}`,
    name: `UML · ${label}`,
    collection: 'uml',
    diagramKind,
    create: (name: string) => uml(name, diagramKind),
  })),
  ...(['process', 'collaboration', 'conversation', 'choreography'] as const).map((diagramKind) => ({
    key: `bpmn-${diagramKind}`,
    name: `BPMN · ${diagramKind[0].toUpperCase()}${diagramKind.slice(1)}`,
    collection: 'bpmn',
    diagramKind,
    create: (name: string) => bpmn(name, diagramKind),
  })),
] as const;

/** Stable discovery metadata; examples are constructed only when requested. */
const nodeCounts: Record<string, number> = {
  hipo: 6,
  'dfd-yourdon-demarco': 6,
  'dfd-gane-sarson': 6,
  'uml-class': 5,
  'uml-object': 3,
  'uml-package': 5,
  'uml-component': 5,
  'uml-composite-structure': 5,
  'uml-deployment': 5,
  'uml-profile': 3,
  'uml-use-case': 5,
  'uml-activity': 7,
  'uml-state-machine': 5,
  'uml-sequence': 5,
  'uml-communication': 3,
  'uml-interaction-overview': 6,
  'uml-timing': 3,
  'bpmn-process': 13,
  'bpmn-collaboration': 8,
  'bpmn-conversation': 4,
  'bpmn-choreography': 4,
};
export const notationTemplates = definitions.map(({ key, name, collection, diagramKind }) => ({
  key,
  name,
  type: 'freeform' as const,
  collection,
  diagramKind,
  nodes: nodeCounts[key],
}));

/** Fresh native IDs avoid reusing references when the same starting set is opened again. */
export function createNotationGraph(key: string, name: string): Graph | undefined {
  return definitions.find((definition) => definition.key === key)?.create(name);
}
