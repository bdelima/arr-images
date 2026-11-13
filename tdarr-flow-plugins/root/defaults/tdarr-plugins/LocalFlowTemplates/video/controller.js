'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "Controller" (originally _id WReQY_XGS, now HWxfel7zZ) on 2026-11-08, and
// brought up to the live "Controller (0.6.0)" on 2026-11-10 (the build stamps the template's version onto the name, so the name here stays plain). Changes from that update: the "Route to local CPU" and "Mark step: landed on local" nodes are gone, Input File
// leads through "Mark step: controller start" straight into Run Health Check, and three node positions moved.
// Brought up to the live "Controller (v10)" on 2026-11-11: new "Queue to mapped nodes" (Tags: Worker Type, CPU worker on a node tagged mapped) between Input File and
// "Mark step: controller start". An unmapped encoder node that picks the job up at Input File re-queues it to a mapped node there, and its job log says it did
// not download the file ("unmapped node, tags plugin after start plugin, no need to download file"). Three node positions moved.
// Quality tier, 2026-11-12: new "Set Encode Quality" between Check Source Efficiency output 1 and Go To Converter Flow. It sets the Flow Variable tdarrQuality (the baseline quality
// number: 18, or 31 for a source above 30 fps) and the Converter's "Set Quality With Node Offset" adds the encode node's offset to it. The Check Force Reencode path to the Converter is unchanged
// (no tdarrQuality there, so the Converter keeps the quality its Set Video Encoder node writes, plus the node offset).
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
          "x": 612,
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
          "x": 612,
          "y": -204
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
          "enabled": "false",
          "minBpp": "0.08",
          "legacyMinBpp": "0.04",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "chkSrcEff",
        "position": {
          "x": 828,
          "y": -12
        }
      },
      {
        "name": "Set Encode Quality",
        "sourceRepo": "Local",
        "pluginName": "setEncodeQuality",
        "version": "1.0.0",
        "inputsDB": {
          "quality": "18",
          "highFpsAbove": "30",
          "highFpsQuality": "31"
        },
        "fpEnabled": true,
        "id": "setEncQuality",
        "position": {
          "x": 948,
          "y": 48
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
          "x": 1080,
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
          "x": 1260,
          "y": 108
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
          "x": 612,
          "y": -120
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
      },
      {
        "name": "Mark step: controller start",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "controller-start"
        },
        "fpEnabled": true,
        "id": "ctrlMarkStart",
        "position": {
          "x": 612,
          "y": -240
        }
      },
      {
        "name": "Mark step: quick health check done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "controller-hc-done"
        },
        "fpEnabled": true,
        "id": "ctrlMarkHc",
        "position": {
          "x": 612,
          "y": -168
        }
      },
      {
        "name": "Queue to mapped nodes",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "id": "ps-ThIC3R",
        "position": {
          "x": 612,
          "y": -276
        },
        "fpEnabled": true,
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "mapped"
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
        "target": "setEncQuality",
        "targetHandle": null,
        "id": "effToQuality"
      },
      {
        "source": "setEncQuality",
        "sourceHandle": "1",
        "target": "V0fhZ7bDk",
        "targetHandle": null,
        "id": "qualityToConverter"
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
        "target": "ctrlMarkHc",
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
        "source": "ctrlMarkHc",
        "sourceHandle": "1",
        "target": "ctrlGoToCleanup",
        "targetHandle": null,
        "id": "ctrlE1b"
      },
      {
        "source": "ctrlMarkStart",
        "sourceHandle": "1",
        "target": "Pu7lH9MsN",
        "targetHandle": null,
        "id": "wX1SDPG_j"
      },
      {
        "source": "ps-ThIC3R",
        "sourceHandle": "1",
        "target": "ctrlMarkStart",
        "targetHandle": null,
        "id": "pAqRJHOFu"
      },
      {
        "source": "6sLbd7Q3m",
        "sourceHandle": "1",
        "target": "ps-ThIC3R",
        "targetHandle": null,
        "id": "Kd_QSFHUx"
      }
    ]
  });
exports.details = details;
