import Category from "../models/Category.js";
import { createCrudController } from "./crudController.js";

export default createCrudController(Category, "Category");
