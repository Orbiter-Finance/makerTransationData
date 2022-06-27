#!/usr/bin/env node
import inquirer from "inquirer";
import figlet from "figlet";
import chalk from "chalk";
import { Socket } from "net";
import { NetUtil } from "./net";
const operateChoices = [
  {
    title: "DYDX Key:",
    key: "11",
  },
];
class InjectBin {
  private netClient: Socket = NetUtil.createClient('injectServer');
  constructor() {
    console.log(
      chalk.green(
        figlet.textSync("Orbiter-Finance", {
          horizontalLayout: "full",
          verticalLayout: "full",
        })
      )
    );
    this.netClient.on("data", (req: string) => {
      const body = JSON.parse(req);
      if (body.op && body.op === "inject-success") {
        console.log('Inject SUCCESS')
        process.exit();
      }
    });
  }
  async run() {
    const questions = [
      {
        type: "list",
        name: "title",
        message: "What do you want to do?",
        choices: [
          new inquirer.Separator(),
          ...operateChoices.map((row) => row.title),
          new inquirer.Separator(),
        ],
      },
      {
        type: "password",
        mask: "*",
        name: "value",
        message: "What is your Config Value?",
      },
    ];
    const result = await inquirer.prompt(questions);
    const op = operateChoices.find(row => row.title== result.title);
    result['key'] = op?.key;
    this.netClient.write(JSON.stringify({ op: "inject", data: result }));
  }
}
new InjectBin().run();
