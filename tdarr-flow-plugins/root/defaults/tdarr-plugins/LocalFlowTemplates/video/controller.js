'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "Controller" (originally _id WReQY_XGS, now HWxfel7zZ) on 2026-11-08.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "HWxfel7zZ",
    "name": "Controller",
    "description": "Controller",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Input File",
        "sourceRepo": "Community",
        "pluginName": "inputFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "6sLbd7Q3m",
        "position": {
          "x": 672,
          "y": -312
        }
      },
      {
        "name": "Run Health Check",
        "sourceRepo": "Community",
        "pluginName": "runHealthCheck",
        "version": "1.0.0",
        "inputsDB": {
          "gpuAcceleration": "qsv"
        },
        "fpEnabled": true,
        "id": "Pu7lH9MsN",
        "position": {
          "x": 672,
          "y": -216
        }
      },
      {
        "name": "Classify Source",
        "sourceRepo": "Local",
        "pluginName": "classifySource",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "classifySrc",
        "position": {
          "x": 948,
          "y": -240
        }
      },
      {
        "name": "Check Force Reencode",
        "sourceRepo": "Community",
        "pluginName": "checkFlowVariable",
        "version": "1.0.0",
        "inputsDB": {
          "variable": "{{{args.userVariables.library.forceReencode}}}",
          "condition": "==",
          "value": "true"
        },
        "fpEnabled": true,
        "id": "chkForceReencode",
        "position": {
          "x": 1152,
          "y": -108
        }
      },
      {
        "name": "Check Source Efficiency",
        "sourceRepo": "Local",
        "pluginName": "checkSourceEfficiency",
        "version": "1.0.0",
        "inputsDB": {
          "enabled": "true",
          "minBpp": "0.08",
          "legacyMinBpp": "0.04",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "chkSrcEff",
        "position": {
          "x": 804,
          "y": 0
        }
      },
      {
        "name": "Go To Converter Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "20ZN6oc41",
          "pluginId": "X4ANCc9vI"
        },
        "fpEnabled": true,
        "id": "V0fhZ7bDk",
        "position": {
          "x": 804,
          "y": 108
        }
      },
      {
        "name": "Go To Clean Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "kASAOsE1n",
          "pluginId": "YWo6oScBV"
        },
        "fpEnabled": true,
        "id": "JUvzFjlQc",
        "position": {
          "x": 1320,
          "y": 120
        }
      },
      {
        "name": "🛬 Returned from Converter Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "retFromConv",
        "position": {
          "x": 1440,
          "y": -312
        }
      },
      {
        "name": "🛬 Returned from Clean Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "retFromClean",
        "position": {
          "x": 1212,
          "y": -312
        }
      },
      {
        "name": "🛫 Go To Validator Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "Yaax7LBej",
          "pluginId": "FShP88xbj"
        },
        "fpEnabled": true,
        "id": "goToValidator",
        "position": {
          "x": 1440,
          "y": -228
        }
      },
      {
        "name": "🛫 Go To Stream Cleanup Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "StreamCleanup_PENDING",
          "pluginId": "scEntry"
        },
        "fpEnabled": true,
        "id": "ctrlGoToCleanup",
        "position": {
          "x": 672,
          "y": -168
        }
      },
      {
        "name": "🛬 Returned from Stream Cleanup Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "retFromCleanup",
        "position": {
          "x": 948,
          "y": -312
        }
      },
      {
        "name": "Tags: Requeue to local",
        "sourceRepo": "Community",
        "pluginName": "tagsRequeue",
        "version": "1.0.0",
        "inputsDB": {
          "useBasicQueueTags": "false",
          "customQueueTags": "requireCPU,local"
        },
        "fpEnabled": true,
        "id": "ctrlReqLocal",
        "position": {
          "x": 672,
          "y": -264
        }
      },
      {
        "name": "🛫 Go To Validator Flow (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "Yaax7LBej",
          "pluginId": "FShP88xbjPT"
        },
        "fpEnabled": true,
        "id": "goToValidatorPT",
        "position": {
          "x": 1212,
          "y": -240
        }
      }
    ],
    "flowEdges": [
      {
        "source": "classifySrc",
        "sourceHandle": "1",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "h264NotHdrToConverter"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "2",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "h264HdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "3",
        "target": "chkForceReencode",
        "targetHandle": null,
        "id": "hevcNotHdrToForceCheck"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "4",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "hevcHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "5",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "av1NotHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "6",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "av1HdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "7",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "legacyNotHdrToConverter"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "8",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "legacyHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "9",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "otherNotHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "10",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "otherHdrToClean"
      },
      {
        "source": "chkForceReencode",
        "sourceHandle": "1",
        "target": "V0fhZ7bDk",
        "targetHandle": null,
        "id": "forceToConverter"
      },
      {
        "source": "chkForceReencode",
        "sourceHandle": "2",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "forceToClean"
      },
      {
        "source": "chkSrcEff",
        "sourceHandle": "1",
        "target": "V0fhZ7bDk",
        "targetHandle": null,
        "id": "effToConverter"
      },
      {
        "source": "chkSrcEff",
        "sourceHandle": "2",
        "target": "JUvzFjlQc",
        "targetHandle": null,
        "id": "effToClean"
      },
      {
        "source": "retFromConv",
        "sourceHandle": "1",
        "target": "goToValidator",
        "targetHandle": null,
        "id": "convToValid"
      },
      {
        "source": "retFromClean",
        "sourceHandle": "1",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "cleanToValid"
      },
      {
        "source": "Pu7lH9MsN",
        "sourceHandle": "1",
        "target": "ctrlGoToCleanup",
        "targetHandle": null,
        "id": "ctrlE1"
      },
      {
        "source": "retFromCleanup",
        "sourceHandle": "1",
        "target": "classifySrc",
        "targetHandle": null,
        "id": "ctrlE2"
      },
      {
        "source": "6sLbd7Q3m",
        "sourceHandle": "1",
        "target": "ctrlReqLocal",
        "targetHandle": null,
        "id": "ctrlE3"
      },
      {
        "source": "ctrlReqLocal",
        "sourceHandle": "1",
        "target": "Pu7lH9MsN",
        "targetHandle": null,
        "id": "ctrlE4"
      }
    ]
  });
exports.details = details;
