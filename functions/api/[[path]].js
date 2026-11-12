import adapter from './adapter.cjs';

export function onRequest(context) {
  return adapter.dispatch(context.request, context.env);
}
