import { ElementCategory, ElementTypeId } from './element-type.model';

/** Static tool metadata — not stored in DB; drives the sidebar UI. Default
 *  instance values live in the element factory. */
export interface ElementDefinition {
  id: ElementTypeId;
  category: ElementCategory;
  title: string;
  description: string;
  icon: string;
}
