const ScreepsAPI = require('screeps-api')
const blessed = require('blessed');
const configManager = require('../src/config_manager');
const printf = require('printf');
const _ = require('lodash');
const Console = require('./console');
const EventEmitter = require('events');

const MOTD = "Now showing Screeps console. Type /help for help.";

class Gauges extends blessed.box {
  constructor(opts) {
    super(Object.assign({
      style: { inverse: true },
    }, opts));

    this.cpuLabel = blessed.text({
      parent: this,
      top: 0,
      left: 0,
      height: 1,
      width: 12,
      content: "CPU:    /   ",
      style: { inverse: true },
    });

    this.cpuBar = blessed.progressbar({
      parent: this,
      top: 0,
      height: 1,
      left: this.cpuLabel.width + 1,
      right: this.width / 2 - 1,
      pch: '|',
      bch: ' ',
      style: { inverse: true, bar: { inverse: true } },
    });

    this.memLabel = blessed.text({
      parent: this,
      top: 0,
      left: this.width / 2,
      height: 1,
      width: 16,
      content: "Mem:     K/    K",
      style: { inverse: true },
    });

    this.memBar = blessed.progressbar({
      parent: this,
      top: 0,
      height: 1,
      left: this.memLabel.left + this.memLabel.width + 1,
      right: this.width - 1,
      pch: '|',
      bch: ' ',
      style: { inverse: true, bar: { inverse: true } },
    });
  }

  update(cpu_current, cpu_limit, mem_current, mem_limit) {
    if (Number.isNaN(parseInt(cpu_current, 10))) {
      this.cpuLabel.setContent("CPU: ERROR");
      this.cpuBar.setProgress(100);
    } else {
      this.cpuLabel.setContent(printf("CPU: %3d/%3d", cpu_current, cpu_limit));
      this.cpuBar.setProgress(cpu_current / cpu_limit * 100);
    }
    this.memLabel.setContent(printf("Mem: %4dK/%4dK", mem_current / 1024, mem_limit / 1024));
    this.memBar.setProgress(mem_current / mem_limit * 100);
    this.screen.render();
  }

}

module.exports = class Multimeter extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.commands = {};
    this.cpuLimit = 1;
    this.memoryLimit = 2097152;

    this.addCommand("quit", "Exit the program.", this.commandQuit.bind(this));
    this.addCommand("help", "List the available commands.", this.commandHelp.bind(this));
  }

  run() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Screeps",
    });

    this.gauges = new Gauges({
      parent: this.screen,
      top: 0,
      left: 0,
      width: this.screen.width,
      height: 1,
    });

    this.console = new Console({
      parent: this.screen,
      top: 1,
      left: 0,
      width: this.screen.width,
      height: this.screen.height - 1,
    });

    this.console.focus();

    this.console.on('line', (command) => {
      if (command[0] == '/') {
        let args = command.slice(1).split(' ');
        let cmd = this.commands[args[0]];
        if (cmd) {
          cmd.handler.call(null, args.slice(1));
        } else {
          this.console.log("Invalid command: " + args[0]);
        }
      } else if (command.length > 0) {
        this.console.addLines('console', command);
        if (this.api) this.api.console(command);
      }
      this.screen.render();
    });

    this.connect()
      .then((api) => {
        this.console.log(MOTD);
      });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.console.log("Connecting to Screeps as " + this.config.email + "...");
      this.api = new ScreepsAPI();
      this.api.auth(this.config.email, this.config.password, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      })
    }).then(() => new Promise((resolve, reject) => {
      this.api.socket();

      this.api.on('message', (msg) => {
        if (msg.slice(0, 7) == 'auth ok') {
          resolve(this.api);
        }
      })
    })).then((api) => {
      this.api.subscribe('/console');
      this.api.subscribe('/cpu');
      this.api.subscribe('/code');
      this.api.on('console', (msg) => {
        let [user, data] = msg;
        if (data.messages) {
          data.messages.log.forEach(l => this.console.addLines('log', l))
          data.messages.results.forEach(l => this.console.addLines('result', l))
        }
        if (data.error) this.console.addLines('error', data.error);
      });
      this.api.on('message', (msg) => {
        if (msg[0].slice(-4) == "/cpu") {
          let cpu = msg[1].cpu, memory = msg[1].memory;
          this.gauges.update(cpu, this.cpuLimit, memory, this.memoryLimit);
        }
      });
      this.api.on('code', (msg) => {
        this.console.addLines('system', 'Code updated');
      });

      this.api.me((err, data) => {
        this.cpuLimit = data.cpu;
        this.memLimit = 2097152;
      });

      return api;
    });
  }

  handleComplete(line) {
    if (line[0] == '/') {
      let prefix = line.slice(1).toLowerCase();
      let options = _.filter(Object.keys(this.commands), (k) => prefix == k.slice(0, prefix.length));
      return [ options.map((l) => "/" + l), line ];
    } else {
      return [[], line];
    }
  }

  addCommand(command, description, handler) {
    this.commands[command] = { description, handler };
  }

  commandQuit() {
    this.emit('exit');
  }

  commandHelp() {
    this.console.addLines('system', 'Available commands:\n' + _.map(this.commands, (cmd, key) => '/' + key + '\t' + cmd.description).join('\n'));
  }
};