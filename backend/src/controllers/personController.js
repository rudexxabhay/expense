import Person from "../models/Person.js";
import { createCrudController } from "./crudController.js";

export default createCrudController(Person, "Person");
