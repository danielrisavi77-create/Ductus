import {describe,expect,it} from "vitest";import {advisoryClassifications,diffText} from "./diff";
describe("deterministic diff",()=>{
 it("returns unchanged tokens for identical Croatian text",()=>{const r=diffText("obvezno glasovanje","obvezno glasovanje");expect(r.changed).toBe(false);expect(r.tokens.every(x=>x.kind==="same")).toBe(true);});
 it("shows removed and added words",()=>{const r=diffText("rezultati pokazuju povezanost","rezultati dokazuju uzročnost");expect(r.removedWords).toEqual(expect.arrayContaining(["pokazuju","povezanost"]));expect(r.addedWords).toEqual(expect.arrayContaining(["dokazuju","uzročnost"]));});
 it("preserves Croatian diacritics",()=>expect(diffText("moguća promjena","značajna promjena").tokens.map(x=>x.text)).toContain("moguća"));
});
describe("advisory classifications",()=>{
 it("detects numeric changes without judging meaning",()=>expect(advisoryClassifications("N = 238, p = 0,031","N = 241, p = 0,044").some(x=>x.kind==="numeric-change")).toBe(true));
 it("detects negation changes",()=>expect(advisoryClassifications("model nije primjenjiv","model je primjenjiv").some(x=>x.kind==="negation-change")).toBe(true));
 it("detects modal vocabulary changes",()=>expect(advisoryClassifications("rezultat pokazuje povezanost","rezultat dokazuje povezanost").some(x=>x.kind==="modal-strength-change")).toBe(true));
 it("does not invent a classification for unrelated neutral wording",()=>expect(advisoryClassifications("analiza obuhvaća uzorak","analiza uključuje uzorak")).toEqual([]));
});
