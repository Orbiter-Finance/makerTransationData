import { convertMakerConfig } from "../utils";
import fs from "fs";
const maker1List = convertMakerConfig(require("./config/maker-80c.json"));
const maker2List = convertMakerConfig(require("./config/maker-e4e.json"));
const allList = [...maker1List, ...maker2List];
fs.writeFile("./allMaker.json", JSON.stringify(allList), error => {
  if (error) {
    console.log("An error has occurred ", error);
    return;
  }
  console.log("Data written successfully to disk");
});
