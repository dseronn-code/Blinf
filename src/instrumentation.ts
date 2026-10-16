// Inicializa o worker da fila de tarefas no processo do servidor Node.js
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DISABLE_WORKER !== 'true') {
    const { startWorker } = await import('./server/services/jobs');
    startWorker();
  }
}
