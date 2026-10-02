import Tag from "../models/Tag.js";
import { createCrudController } from "./crudController.js";

export default createCrudController(Tag, "Tag", { hasIsActive: false });
