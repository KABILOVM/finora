/* Файл создан скриптом scripts/gen-tj-services.cjs — руками не править.
 * Таджикские банки и сервисы, у которых есть иконка в public/tj/<id>.png (значок приложения). Названия и значки — товарные знаки их владельцев. */
import type { ServiceMeta } from './serviceData';

export const TJ_GROUPS: readonly { id: string; label: string }[] = [{"id":"tjbank","label":"Банки Таджикистана"},{"id":"tjpay","label":"Сервисы Таджикистана"}];

export const TJ_SERVICES: readonly ServiceMeta[] = [
  {"id":"alifbank","name":"Алиф","group":"tjbank","color":"#ffffff","img":"tj/alifbank.png","keys":["alif","алиф банк","alif mobi","алиф моби"]},
  {"id":"dcbank","name":"Душанбе Сити Банк","group":"tjbank","color":"#ffffff","img":"tj/dcbank.png","keys":["dc","dc next","душанбе сити"]},
  {"id":"eskhata","name":"Эсхата","group":"tjbank","color":"#ffffff","img":"tj/eskhata.png","keys":["eskhata","эсхата банк","эсхата онлайн"]},
  {"id":"amonatbonk","name":"Амонатбонк","group":"tjbank","color":"#ffffff","img":"tj/amonatbonk.png","keys":["амонатбанк","amonatbank","амонат"]},
  {"id":"orienbank","name":"Ориёнбонк","group":"tjbank","color":"#ffffff","img":"tj/orienbank.png","keys":["ориёнбанк","ориенбанк","oriyonbonk","oriyon"]},
  {"id":"spitamen","name":"Спитамен Банк","group":"tjbank","color":"#ffffff","img":"tj/spitamen.png","keys":["спитамен"]},
  {"id":"ssb","name":"Саноатсодиротбонк","group":"tjbank","color":"#ffffff","img":"tj/ssb.png","keys":["ссб","ssb","sanoatsodirotbonk"]},
  {"id":"arvand","name":"Банк Арванд","group":"tjbank","color":"#ffffff","img":"tj/arvand.png","keys":["арванд"]},
  {"id":"imon","name":"Имон Интернешнл","group":"tjbank","color":"#ffffff","img":"tj/imon.png"},
  {"id":"ibt","name":"Международный банк Таджикистана","group":"tjbank","color":"#ffffff","img":"tj/ibt.png","keys":["ibt"]},
  {"id":"matin","name":"Матин","group":"tjbank","color":"#ffffff","img":"tj/matin.png"},
  {"id":"cbt","name":"Коммерцбанк Таджикистана","group":"tjbank","color":"#ffffff","img":"tj/cbt.png","keys":["коммерцбанк","favri"]},
  {"id":"icb","name":"Инвестиционно-кредитный банк Таджикистана","group":"tjbank","color":"#ffffff","img":"tj/icb.png","keys":["icb","икб"]},
  {"id":"dbt","name":"Бонки рушд","group":"tjbank","color":"#ffffff","img":"tj/dbt.png","keys":["банк развития"]},
  {"id":"freedom","name":"Freedom Bank","group":"tjbank","color":"#ffffff","img":"tj/freedom.png"},
  {"id":"humo","name":"Хумо","group":"tjbank","color":"#ffffff","img":"tj/humo.png","keys":["humo"]},
  {"id":"tcell","name":"Tcell","group":"tjpay","color":"#ffffff","img":"tj/tcell.png","keys":["тселл","тсел"]},
  {"id":"babilon","name":"Babilon-M","group":"tjpay","color":"#ffffff","img":"tj/babilon.png","keys":["вавилон","бабилон"]},
  {"id":"zetmobile","name":"Zet-Mobile","group":"tjpay","color":"#ffffff","img":"tj/zetmobile.png","keys":["zet","зет"]},
  {"id":"tojiktelecom","name":"Таджиктелеком","group":"tjpay","color":"#ffffff","img":"tj/tojiktelecom.png","keys":["tojiktelecom"]},
  {"id":"oson","name":"OSON","group":"tjpay","color":"#ffffff","img":"tj/oson.png","keys":["осон"]},
  {"id":"somon","name":"Somon.tj","group":"tjpay","color":"#ffffff","img":"tj/somon.png","keys":["somon","сомон"]},
  {"id":"somonair","name":"Somon Air","group":"tjpay","color":"#ffffff","img":"tj/somonair.png","keys":["сомон эйр"]},
  {"id":"andozi","name":"Андози ман","group":"tjpay","color":"#ffffff","img":"tj/andozi.png","keys":["andozi","андози"]},
];
