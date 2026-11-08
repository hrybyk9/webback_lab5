import fs from 'node:fs/promises';   // лише проміс-версія модуля fs
import path from 'node:path';
import { Command } from 'commander';

// Параметри командного рядка
const program = new Command();

program
  // -h зайнята під --host, тому довідку залишаємо лише як --help
  .helpOption('--help', 'показати довідку')
  // requiredOption: якщо опції немає — commander сам виводить помилку
  // і завершує програму з ненульовим кодом
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до теки з кешем');

program.parse();
const options = program.opts();

// Перетворюємо порт на число і перевіряємо, що він коректний
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Помилка: порт має бути цілим числом від 1 до 65535');
  process.exit(1);
}

// Повний (абсолютний) шлях до теки кешу
const cacheDir = path.resolve(options.cache);

//  Створення теки кешу 
// recursive: true — створює всі проміжні теки і НЕ дає помилки,
// якщо тека вже існує. await гарантує, що тека з'явиться
// ДО того, як сервер почне приймати запити.
try {
  await fs.mkdir(cacheDir, { recursive: true });
} catch (err) {
  console.error(`Не вдалося створити теку кешу: ${err.message}`);
  process.exit(1);
}