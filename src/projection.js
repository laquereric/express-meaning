// THE PROJECTION: what this application answers on the seam.
//
// The seam (src/cpcp/back/seam.js) is generic and knows nothing about todos.
// This file is the one place the two meet -- the same separation rails-cpcp
// draws between its engine and the initializer that projects a resource.
//
// Everything here is domain. Everything in src/cpcp/ is protocol. A second
// application replaces this file and keeps the rest.

import * as seam from './cpcp/back/seam.js';
import * as todos from './todos.js';

export const BASE_IRI = process.env.CPCP_BASE_IRI || 'http://127.0.0.1:3200';

/**
 * Register the todo operations. Idempotent: safe to call twice, which a test
 * that resets the registry between cases needs.
 *
 * Direction is contract, not decoration. A reader of the CID can tell which
 * calls cost something: PUSH requires an operationId, PULL must not need one.
 */
export function project() {
  seam.register('todo.list', {
    direction: 'PULL', summary: 'List every todo',
    params: [], result: { shape: 'Collection' },
    run: () => todos.list(),
  });

  seam.register('todo.create', {
    direction: 'PUSH', summary: 'Create a todo (PUSH; idempotent by operationId)',
    params: ['title'],
    run: (p) => todos.add(p.title),
  });

  seam.register('todo.toggle', {
    direction: 'PUSH', summary: 'Toggle a todo done/undone (PUSH; idempotent by operationId)',
    params: ['id'],
    run: (p) => todos.toggle(p.id),
  });

  seam.register('todo.remove', {
    direction: 'PUSH', summary: 'Delete a todo (PUSH; idempotent by operationId)',
    params: ['id'],
    run: (p) => todos.remove(p.id),
  });

  seam.register('todo.clearDone', {
    direction: 'PUSH', summary: 'Delete every completed todo (PUSH; idempotent by operationId)',
    params: [],
    run: () => todos.clearDone(),
  });

  return seam.operations();
}
