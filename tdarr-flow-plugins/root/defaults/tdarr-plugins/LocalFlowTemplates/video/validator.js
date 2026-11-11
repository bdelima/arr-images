'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Live Tdarr flow "Validator" (original flow _id: Yaax7LBej), exported 2026-11-08, plus a Tag Output Metadata node (id tagOutMeta) in front of Replace Original File. On 2026-11-10 the node positions and the passthrough size floor (Compare File Size Ratio (passthrough) greaterThan 70, was 25) were taken from Bob's live "Validator (0.5.1)". The four VMAF nodes (ids vmafCheck1, vmafCheck1_10bit, vmafCheck4k, vmafCheck4k_10bit) are instances of the Local plugin runVmaf instead of Run CLI shell scripts; same names, positions and edges.
// Brought up to the live "Validator (0.6.0)" on 2026-11-10 (the version suffix is stamped on at image build, so the name here stays plain). Changes from that update: node id reqLocalPT is now "Queue back to VMAF node" (CPU worker, node tag vmaf, was "Queue back to local" with tag local) and sits at the start of the re-encode path (Entry re-encoded -> Queue back to VMAF node -> Mark step: back on local -> Compare File Size Ratio); the passthrough path now goes from Mark step: thorough health check done straight to Require health check before Replace; node positions moved. The Require health check before Replace gate (valRequireHc) requires validator-hc-queue and validator-hc-done only. The live 0.6.0 flow also listed validator-back-local there, but that mark is now stamped only on the re-encode path, which does not go through the gate, so requiring it failed every passthrough job; it is removed from the gate here.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "Yaax7LBej",
    "name": "Validator",
    "description": "Validator",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Controller Flow (re-encoded)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "FShP88xbj",
        "position": {
          "x": 504,
          "y": -96
        }
      },
      {
        "name": "Compare File Size Ratio",
        "sourceRepo": "Community",
        "pluginName": "compareFileSizeRatio",
        "version": "2.0.0",
        "inputsDB": {
          "greaterThan": "25"
        },
        "fpEnabled": true,
        "id": "01GZNv02y",
        "position": {
          "x": 504,
          "y": 24
        }
      },
      {
        "name": "Compare File Duration Ratio",
        "sourceRepo": "Community",
        "pluginName": "compareFileDurationRatio",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "CUsET8PD3",
        "position": {
          "x": 408,
          "y": 108
        }
      },
      {
        "name": "Fail Flow",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "WrieN1BV1",
        "position": {
          "x": 792,
          "y": 240
        }
      },
      {
        "name": "Check Video Resolution",
        "sourceRepo": "Community",
        "pluginName": "checkVideoResolution",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "checkRes4k",
        "position": {
          "x": 384,
          "y": 216
        }
      },
      {
        "name": "Check 10 Bit Video",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "check10BitStd",
        "position": {
          "x": 324,
          "y": 312
        }
      },
      {
        "name": "Check 10 Bit Video (4K)",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "check10Bit4k",
        "position": {
          "x": 624,
          "y": 348
        }
      },
      {
        "name": "Run VMAF Quality Check",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "inputsDB": {
          "pixelFormat": "yuv420p",
          "model": "default",
          "minMean": "93"
        },
        "fpEnabled": true,
        "id": "vmafCheck1",
        "position": {
          "x": 408,
          "y": 396
        }
      },
      {
        "name": "Run VMAF Quality Check (10-bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "inputsDB": {
          "pixelFormat": "yuv420p10le",
          "model": "default",
          "minMean": "93"
        },
        "fpEnabled": true,
        "id": "vmafCheck1_10bit",
        "position": {
          "x": 240,
          "y": 384
        }
      },
      {
        "name": "Run VMAF Quality Check (4K model)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "inputsDB": {
          "pixelFormat": "yuv420p",
          "model": "vmaf_4k_v0.6.1",
          "minMean": "93"
        },
        "fpEnabled": true,
        "id": "vmafCheck4k",
        "position": {
          "x": 732,
          "y": 444
        }
      },
      {
        "name": "Run VMAF Quality Check (4K model, 10-bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "inputsDB": {
          "pixelFormat": "yuv420p10le",
          "model": "vmaf_4k_v0.6.1",
          "minMean": "93"
        },
        "fpEnabled": true,
        "id": "vmafCheck4k_10bit",
        "position": {
          "x": 564,
          "y": 444
        }
      },
      {
        "name": "Tag Output Metadata",
        "sourceRepo": "Local",
        "pluginName": "tagOutputMetadata",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "tagOutMeta",
        "position": {
          "x": 936,
          "y": 600
        }
      },
      {
        "name": "Replace Original File",
        "sourceRepo": "Community",
        "pluginName": "replaceOriginalFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "1g5GNL1MP",
        "position": {
          "x": 936,
          "y": 648
        }
      },
      {
        "name": "Entry from Controller Flow (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "FShP88xbjPT",
        "position": {
          "x": 864,
          "y": -96
        }
      },
      {
        "name": "Compare File Size Ratio (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "compareFileSizeRatio",
        "version": "2.0.0",
        "inputsDB": {
          "greaterThan": "70"
        },
        "fpEnabled": true,
        "id": "01GZNv02yPT",
        "position": {
          "x": 1128,
          "y": -72
        }
      },
      {
        "name": "Compare File Duration Ratio (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "compareFileDurationRatio",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "CUsET8PD3PT",
        "position": {
          "x": 1020,
          "y": 0
        }
      },
      {
        "name": "Queue Full Healthcheck",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "healthcheck-full"
        },
        "fpEnabled": true,
        "id": "reqOjochalHC",
        "position": {
          "x": 1104,
          "y": 192
        }
      },
      {
        "name": "Run Thorough Health Check",
        "sourceRepo": "Community",
        "pluginName": "runHealthCheck",
        "version": "1.0.0",
        "inputsDB": {
          "type": "thorough",
          "gpuAcceleration": "qsv"
        },
        "fpEnabled": true,
        "id": "healthCheckPT",
        "position": {
          "x": 1320,
          "y": 240
        }
      },
      {
        "name": "Queue back to VMAF node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "vmaf"
        },
        "fpEnabled": true,
        "id": "reqLocalPT",
        "position": {
          "x": 504,
          "y": -48
        }
      },
      {
        "name": "Mark step: landed for health check",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-queue"
        },
        "fpEnabled": true,
        "id": "valMarkHcQueue",
        "position": {
          "x": 1320,
          "y": 192
        }
      },
      {
        "name": "Mark step: thorough health check done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valMarkHcDone",
        "position": {
          "x": 1320,
          "y": 288
        }
      },
      {
        "name": "Mark step: back on local",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-back-local"
        },
        "fpEnabled": true,
        "id": "valMarkBackLocal",
        "position": {
          "x": 504,
          "y": -12
        }
      },
      {
        "name": "Require health check before Replace",
        "sourceRepo": "Local",
        "pluginName": "requireTrail",
        "version": "1.0.0",
        "inputsDB": {
          "requiredLabels": "validator-hc-queue,validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valRequireHc",
        "position": {
          "x": 1104,
          "y": 396
        }
      }
    ],
    "flowEdges": [
      {
        "source": "01GZNv02y",
        "sourceHandle": "1",
        "target": "CUsET8PD3",
        "targetHandle": null,
        "id": "pzyuFoO69"
      },
      {
        "source": "01GZNv02y",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "4nXCOOWNQ"
      },
      {
        "source": "CUsET8PD3",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "U2MS0RqpE"
      },
      {
        "source": "CUsET8PD3",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "6FytNy0H9"
      },
      {
        "source": "CUsET8PD3",
        "sourceHandle": "1",
        "target": "checkRes4k",
        "targetHandle": null,
        "id": "T6akumt4z"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "1",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res480ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "2",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res576ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "3",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res720ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "4",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res1080ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "5",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res1440ToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "8",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "res8kToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "9",
        "target": "check10BitStd",
        "targetHandle": null,
        "id": "resOtherToBit"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "6",
        "target": "check10Bit4k",
        "targetHandle": null,
        "id": "res4kuhdToBit4k"
      },
      {
        "source": "checkRes4k",
        "sourceHandle": "7",
        "target": "check10Bit4k",
        "targetHandle": null,
        "id": "resDci4kToBit4k"
      },
      {
        "source": "check10BitStd",
        "sourceHandle": "1",
        "target": "vmafCheck1_10bit",
        "targetHandle": null,
        "id": "bitStdToVmaf10bit"
      },
      {
        "source": "check10BitStd",
        "sourceHandle": "2",
        "target": "vmafCheck1",
        "targetHandle": null,
        "id": "bitStdToVmaf8bit"
      },
      {
        "source": "check10Bit4k",
        "sourceHandle": "1",
        "target": "vmafCheck4k_10bit",
        "targetHandle": null,
        "id": "bit4kToVmaf10bit"
      },
      {
        "source": "check10Bit4k",
        "sourceHandle": "2",
        "target": "vmafCheck4k",
        "targetHandle": null,
        "id": "bit4kToVmaf8bit"
      },
      {
        "source": "vmafCheck1",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmafPassEdge"
      },
      {
        "source": "vmafCheck1_10bit",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmaf10bitPassEdge"
      },
      {
        "source": "vmafCheck4k",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmaf4kPassEdge"
      },
      {
        "source": "vmafCheck4k_10bit",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "vmaf4k10bitPassEdge"
      },
      {
        "source": "FShP88xbjPT",
        "sourceHandle": "1",
        "target": "01GZNv02yPT",
        "targetHandle": null,
        "id": "rTL0zUBDZPT"
      },
      {
        "source": "01GZNv02yPT",
        "sourceHandle": "1",
        "target": "CUsET8PD3PT",
        "targetHandle": null,
        "id": "pzyuFoO69PT"
      },
      {
        "source": "01GZNv02yPT",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "PfcElFxTMPT"
      },
      {
        "source": "01GZNv02yPT",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "4nXCOOWNQPT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "U2MS0RqpEPT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "6FytNy0H9PT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "1",
        "target": "reqOjochalHC",
        "targetHandle": null,
        "id": "ratioToReqOjochal"
      },
      {
        "source": "reqOjochalHC",
        "sourceHandle": "1",
        "target": "valMarkHcQueue",
        "targetHandle": null,
        "id": "reqOjochalToHC"
      },
      {
        "source": "healthCheckPT",
        "sourceHandle": "1",
        "target": "valMarkHcDone",
        "targetHandle": null,
        "id": "hcToReqLocal"
      },
      {
        "source": "reqLocalPT",
        "sourceHandle": "1",
        "target": "valMarkBackLocal",
        "targetHandle": null,
        "id": "reqLocalToReplace"
      },
      {
        "source": "01GZNv02y",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "jTlWGHyso"
      },
      {
        "source": "tagOutMeta",
        "sourceHandle": "1",
        "target": "1g5GNL1MP",
        "targetHandle": null,
        "id": "tagMetaToReplace"
      },
      {
        "source": "valMarkHcQueue",
        "sourceHandle": "1",
        "target": "healthCheckPT",
        "targetHandle": null,
        "id": "reqOjochalToHCb"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "gateToTagMeta"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "gateToFail"
      },
      {
        "source": "valMarkHcDone",
        "sourceHandle": "1",
        "target": "valRequireHc",
        "targetHandle": null,
        "id": "iR16UZ4VY"
      },
      {
        "source": "FShP88xbj",
        "sourceHandle": "1",
        "target": "reqLocalPT",
        "targetHandle": null,
        "id": "qofAT2mS5"
      },
      {
        "source": "valMarkBackLocal",
        "sourceHandle": "1",
        "target": "01GZNv02y",
        "targetHandle": null,
        "id": "EZe8LFgOg"
      }
    ]
  });
exports.details = details;
