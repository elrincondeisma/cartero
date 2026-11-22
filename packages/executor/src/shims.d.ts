declare module 'postman-runtime' {
  const runtime: { Runner: new () => any }
  export default runtime
}
declare module 'postman-collection';
